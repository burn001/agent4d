#!/usr/bin/env python3
"""배경음악 결정적 합성 공용 엔진(2026-10-30, 표현×단계 24곡 compose_<id>.py 공용).

Planet 묶음(compose_nebula.py 등)의 층(Layer)·섹션 곡선·사이드체인·에코·리버브·마스터링과
복셀 묶음(compose_bossa.py 등)의 화음 파서·보이싱·가산 악기·드럼을 한 모듈로 모았다.
곡 스크립트는 맨 위에서 `setup(...)` 으로 BPM·박자·섹션·시드를 정하고 `build()` 에서 층을 채운 뒤 `run(build)` 을 부른다.

- 원형 버퍼(정확히 300초) 합성: 끝을 넘는 음 꼬리·리버브·에코는 앞머리로 감기고, 섹션 레벨 곡선도 원형으로
  정상 상태를 맞춘다 → `<audio loop>` 이음매가 끊기지 않는다(MP3 인코더 지연 약 25ms 는 남음).
- 마스터: BS.1770 K 가중 게이트 라우드니스 근사 −16 LUFS, 룩어헤드 리미터 샘플 피크 −1.5 dBFS, TPDF 디더, 128kbps CBR.
- 외부 샘플 없음, numpy 만. 같은 시드면 MP3 해시가 같다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time

import numpy as np

F32 = np.float32
SR = 44100
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128

# setup() 이 채우는 곡 설정(모듈 전역)
TRACK_ID = TITLE = MOOD = KEY_NAME = ""
SEED = 2026
BPM = 100
BEATS = 4
BEAT = BAR = DUR = 0.0
BARS = N = 0
SECS: list = []
STAGE = 0
ENERGY = 0.5
REVERB = (2.6, 1.8, 0.7)
WET = 0.3
ECHO_BEATS = 0.75
ECHO_FB = 0.45
MASTER_LP = 12000
HI_SHELF = -3.0
rng = np.random.default_rng(SEED)
KICKS: list = []
_NC: dict = {}
_FREQ = None


def setup(track_id, title, mood, key, bpm, secs, stage, energy, seed=2026, beats=4, reverb=(2.6, 1.8, 0.7), wet=0.3,
          echo_beats=0.75, echo_fb=0.45, master_lp=12000, hi_shelf=-3.0):
    """곡 설정. secs = [{"n": 구간 이름, "part": 기/승/전/결, "bars": 마디 수, <층 이름>: 레벨 …}, …].
    첫 구간과 마지막 구간의 층 레벨을 같게 두면 루프 이음매가 자연스럽다."""
    global TRACK_ID, TITLE, MOOD, KEY_NAME, SEED, BPM, BEATS, BEAT, BAR, DUR, BARS, N, SECS, STAGE, ENERGY
    global REVERB, WET, ECHO_BEATS, ECHO_FB, MASTER_LP, HI_SHELF, rng, KICKS, _NC, _FREQ
    TRACK_ID, TITLE, MOOD, KEY_NAME = track_id, title, mood, key
    SEED, BPM, BEATS, STAGE, ENERGY = seed, bpm, beats, stage, energy
    REVERB, WET, ECHO_BEATS, ECHO_FB, MASTER_LP, HI_SHELF = reverb, wet, echo_beats, echo_fb, master_lp, hi_shelf
    BEAT = 60.0 / BPM
    BAR = BEATS * BEAT
    SECS = [dict(s) for s in secs]
    b = 0
    for s in SECS:
        s["start"] = b
        b += s["bars"]
    BARS = b
    DUR = BARS * BAR
    assert abs(DUR - 300.0) < 1e-6, f"길이 {DUR}초 — 마디 수·BPM·박자를 300초에 맞추십시오"
    N = int(round(DUR * SR))
    rng = np.random.default_rng(SEED)
    KICKS = []
    _NC = {}
    _FREQ = None


# ───────────────────────── 기본 ─────────────────────────

def mtof(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def loopf(f):
    return max(1, round(f * DUR)) / DUR


def tb(bar, beat=0.0):
    return bar * BAR + beat * BEAT


def pan_gains(pan):
    a = (pan + 1.0) * math.pi / 4.0
    return math.cos(a), math.sin(a)


def new_bus():
    return np.zeros((2, N), dtype=F32)


def add(buf, t0, sig, pan=0.0):
    if sig.ndim == 1:
        gl, gr = pan_gains(pan)
        sig = np.stack([sig * F32(gl), sig * F32(gr)])
    n = min(sig.shape[1], N)
    sig = sig[:, :n]
    i0 = int(round(t0 * SR)) % N
    end = i0 + n
    if end <= N:
        buf[:, i0:end] += sig
    else:
        k = N - i0
        buf[:, i0:] += sig[:, :k]
        buf[:, : n - k] += sig[:, k:]


def freqs():
    global _FREQ
    if _FREQ is None:
        _FREQ = np.fft.rfftfreq(N, 1.0 / SR)
    return _FREQ


def lp_mag(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))


def hp_mag(f, fc, order=2):
    r = (f / fc) ** (2 * order)
    return np.sqrt(r / (1.0 + r))


def lpq(f, fc, q=0.7071):
    x = f / fc
    return 1.0 / np.sqrt((1 - x * x) ** 2 + (x / q) ** 2)


def bpq(f, fc, q):
    x = f / fc
    return (x / q) / np.sqrt((1 - x * x) ** 2 + (x / q) ** 2 + 1e-30)


def shelf_mag(f, fc, gain_db):
    rr = (f / fc) ** 4
    return 1 + (10 ** (gain_db / 20) - 1) * rr / (1 + rr)


def fd_filter(x, mag):
    X = np.fft.rfft(x, axis=-1)
    X *= mag.astype(X.real.dtype)
    return np.fft.irfft(X, n=x.shape[-1], axis=-1).astype(F32)


def circ_conv(x, ir):
    out = np.zeros((2, N), dtype=F32)
    xs = x if x.ndim == 2 else np.stack([x, x])
    for ch in range(2):
        h = np.zeros(N, dtype=F32)
        h[: ir.shape[1]] = ir[ch]
        out[ch] = np.fft.irfft(np.fft.rfft(xs[ch]) * np.fft.rfft(h), n=N).astype(F32)
    return out


def sec_at(bar):
    bar %= BARS
    for s in SECS:
        if s["start"] <= bar < s["start"] + s["bars"]:
            return s
    return SECS[-1]


def lv(key, bar):
    return sec_at(bar).get(key, 0.0)


def section_curve(key, default=0.0, tau=2.0):
    """섹션 레벨 → 부드러운 곡선(원형으로 두 번 돌려 정상 상태). 어느 섹션에도 키가 없으면 1."""
    if not any(key in s for s in SECS):
        return np.ones(N, dtype=F32)
    cr = 200
    nc = int(DUR * cr)
    tgt = np.zeros(nc)
    for s in SECS:
        tgt[int(round(tb(s["start"]) * cr)):int(round(tb(s["start"] + s["bars"]) * cr))] = s.get(key, default)
    a = 1 - math.exp(-1 / (cr * tau))
    y = np.empty(nc)
    v = tgt[-1]
    for _ in range(2):
        for i in range(nc):
            v += a * (tgt[i] - v)
            y[i] = v
    return np.interp(np.arange(N) / SR, np.arange(nc) / cr, y, period=DUR).astype(F32)


# ───────────────────────── 화음·음계 ─────────────────────────

PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"maj7": [0, 4, 7, 11], "maj9": [0, 4, 7, 11, 14], "6": [0, 4, 7, 9], "69": [0, 4, 7, 9, 14],
        "m7": [0, 3, 7, 10], "m9": [0, 3, 7, 10, 14], "m11": [0, 3, 7, 10, 14, 17], "m6": [0, 3, 7, 9],
        "mmaj7": [0, 3, 7, 11], "7": [0, 4, 7, 10], "9": [0, 4, 7, 10, 14], "13": [0, 4, 7, 10, 14, 21],
        "7b9": [0, 4, 7, 10, 13], "m7b5": [0, 3, 6, 10], "dim7": [0, 3, 6, 9], "7sus": [0, 5, 7, 10],
        "sus2": [0, 2, 7], "sus4": [0, 5, 7], "add9": [0, 4, 7, 14], "madd9": [0, 3, 7, 14],
        "maj7#11": [0, 4, 7, 11, 18], "5": [0, 7], "": [0, 4, 7], "m": [0, 3, 7]}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10], "dorian": [0, 2, 3, 5, 7, 9, 10],
          "phrygian": [0, 1, 3, 5, 7, 8, 10], "lydian": [0, 2, 4, 6, 7, 9, 11], "mixo": [0, 2, 4, 5, 7, 9, 10],
          "harmonic": [0, 2, 3, 5, 7, 8, 11], "penta": [0, 2, 4, 7, 9], "mpenta": [0, 3, 5, 7, 10]}


def pc_of(s):
    p = PC[s[0]]
    if s[1:2] == "#":
        p += 1
    elif s[1:2] == "b":
        p -= 1
    return p % 12


def chord(name):
    """'C#m9' → (근음 pc, 음정 목록, 베이스 pc). 슬래시 베이스 'F/C'."""
    bass = None
    if "/" in name:
        name, b = name.split("/")
        bass = pc_of(b)
    r = PC[name[0]]
    q = name[1:]
    if q[:1] == "#":
        r, q = r + 1, q[1:]
    elif q[:1] == "b":
        r, q = r - 1, q[1:]
    r %= 12
    return r, QUAL[q], (r if bass is None else bass)


def chord_pcs(ch):
    r, iv, _ = ch
    return sorted({(r + i) % 12 for i in iv})


def scale_of(key_pc, mode="major"):
    return sorted((key_pc + i) % 12 for i in SCALES[mode])


def nearest_pc(m, pcs):
    for d in range(0, 12):
        for s in (m - d, m + d):
            if s % 12 in pcs:
                return s
    return m


def step_in(m, n, pcs):
    s = 1 if n > 0 else -1
    for _ in range(abs(n)):
        m += s
        while m % 12 not in pcs:
            m += s
    return m


def voicing(ch, lo, hi, prev=None, rootless=False, maxn=4):
    r, iv, _ = ch
    ivs = [i for i in iv if not (rootless and i == 0)]
    if len(ivs) > maxn:
        ivs = [i for i in ivs if i != 7][:maxn] if 7 in ivs else ivs[:maxn]
    center = (lo + hi) / 2 if prev is None else sum(prev) / len(prev)
    out = []
    for i in ivs:
        pc = (r + i) % 12
        cands = [m for m in range(lo, hi + 1) if m % 12 == pc]
        if cands:
            out.append(min(cands, key=lambda m: abs(m - center)))
    return sorted(set(out))


def bass_note(ch, lo=33):
    """화음의 베이스 pc 를 lo～lo+11 사이 미디 음으로."""
    return lo + (ch[2] - lo) % 12


def phrase(seed, slots, start, lo, hi, chord_at, scale_pcs, leaps=(-4, -2, -1, 1, 2, 3, 5), slot_beats=0.5, bar0=0):
    """결정적 선율: slots = [(슬롯, 길이 슬롯)…](슬롯 = slot_beats 박). 강박·긴 음은 화음 음, 나머지는 음계 걸음.
    chord_at(bar) → chord(). 반환 [(마디, 박, 미디, 길이 박)]."""
    r = np.random.default_rng(seed)
    m, out = start, []
    spb = int(round(BEATS / slot_beats))
    for slot, ln in slots:
        bar = bar0 + slot // spb
        beat = (slot % spb) * slot_beats
        pcs = chord_pcs(chord_at(bar))
        if beat == 0 or ln * slot_beats >= 1.0:
            m = nearest_pc(m + int(r.choice(leaps)), pcs)
        else:
            m = step_in(m, int(r.choice([-1, 1, -2, 2])), scale_pcs)
        while m > hi:
            m = nearest_pc(m - 7, pcs)
        while m < lo:
            m = nearest_pc(m + 7, pcs)
        out.append((bar, beat, m, ln * slot_beats))
    return out


def prog_at(prog, per=2, offset=0):
    """화음 이름 목록 → chord_at(bar). per = 화음 하나의 마디 수."""
    chs = [chord(c) for c in prog]
    return lambda bar: chs[((bar - offset) // per) % len(chs)]


def pads(L, chord_at, lo, hi, every=2, v=0.2, a=1.5, rel=2.5, voices=5, cents=11.0, cond=None, rootless=False, maxn=4):
    """every 마디마다 디튠 패드 화음(보이스 리딩)."""
    prev = None
    for bar in range(0, BARS, every):
        vo = voicing(chord_at(bar), lo, hi, prev, rootless, maxn)
        prev = vo
        if cond and not cond(bar):
            continue
        span = min(every, BARS - bar)
        for m in vo:
            L.add(tb(bar), pad_note(m, span * BAR + 0.3, a, rel, voices, cents), v)


def melody(L, name, bar0, bars, seeds, tmpls, chord_at, scale_pcs, v, pan=0.0, lo=64, hi=81, slot_beats=0.5,
           per=4, start=None, legato=0.95, leaps=(-4, -2, -1, 1, 2, 3, 5), vel_var=0.2):
    """per 마디 프레이즈를 seeds·tmpls 순환으로 이어 붙인 선율. tmpls = [(슬롯, 길이 슬롯)…] 목록들."""
    for k in range(bars // per):
        b = bar0 + per * k
        for bar, beat, m, d in phrase(seeds[k % len(seeds)], tmpls[k % len(tmpls)], start or (lo + hi) // 2, lo, hi,
                                      chord_at, scale_pcs, leaps, slot_beats, b):
            L.note(tb(bar, beat), name, m, d * BEAT * legato, v * (1 - vel_var / 2 + vel_var * rng.random()), pan)


# ───────────────────────── 음원(모노 float32, 캐시) ─────────────────────────

def _table():
    ph = np.arange(4096) / 4096
    y = np.zeros(4096)
    for k in range(1, 13):
        y += np.sin(2 * np.pi * k * ph) / k ** 1.35
    return (y / np.abs(y).max()).astype(F32)


SAW = _table()


def env(n, dur, a, rel):
    t = np.arange(n) / SR
    e = np.ones(n)
    na = max(1, min(n, int(a * SR)))
    e[:na] = 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / na)
    ie = min(n, int(dur * SR))
    if ie < n:
        e[ie:] = e[max(ie - 1, 0)] * np.exp(-(t[ie:] - t[ie]) / rel)
    return t, e


def _gate(t, dur, rel):
    g = np.ones_like(t)
    m = t > dur
    g[m] = np.exp(-(t[m] - dur) / max(rel / 5.0, 1e-4))
    return g


def cached(fn):
    def w(*a, **k):
        key = (fn.__name__, tuple(round(x, 4) if isinstance(x, float) else x for x in a), tuple(sorted(k.items())))
        y = _NC.get(key)
        if y is None:
            y = fn(*a, **k)
            if len(_NC) < 9000:
                _NC[key] = y
        return y
    w.__name__ = fn.__name__
    return w


@cached
def saw_note(m, dur, fc0, fc1=None, tau=0.15, a=0.004, rel=0.06, odd=False, kmax=48, q=0.7071):
    """가산 합성 톱니(odd=True 면 사각): 배음마다 시간 변화 2차 저역통과(공진 q) 크기를 곱해 필터 엔벨로프를 흉내."""
    fc1 = fc0 * 0.3 if fc1 is None else fc1
    f = mtof(m)
    n = int((dur + rel * 6) * SR)
    t, e = env(n, dur, a, rel)
    fc = fc1 + (fc0 - fc1) * np.exp(-t / tau)
    y = np.zeros(n)
    for k in range(1, int(min(kmax, 9000 / f)) + 1):
        if odd and k % 2 == 0:
            continue
        x = k * f / fc
        g = 1.0 / np.sqrt((1 - x * x) ** 2 + (x / q) ** 2)
        y += (g / k) * np.sin(2 * np.pi * k * f * t + 0.7 * k)
    return (y * e * 0.6).astype(F32)


def pad_note(m, dur, a=2.5, rel=3.0, voices=5, cents=11.0, width=0.8):
    """디튠 톱니 패드(표 조회). 스테레오. 위상은 전역 rng(결정적)."""
    f = mtof(m)
    n = int((dur + rel * 5) * SR)
    t, e = env(n, dur, a, rel)
    out = np.zeros((2, n), dtype=F32)
    for i in range(voices):
        d = (i - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        fi = f * 2 ** (d * cents / 1200)
        ph = rng.random()
        idx = ((ph + fi * t) * 4096.0).astype(np.int64) & 4095
        gl, gr = pan_gains(d * width)
        w = SAW[idx] * F32(1 / voices)
        out[0] += w * F32(gl)
        out[1] += w * F32(gr)
    return out * e.astype(F32)[None, :]


@cached
def bell(m, dur=2.5, index=1.4, ratio=2.0, a=0.003):
    f = mtof(m)
    n = int(dur * 1.6 * SR)
    t = np.arange(n) / SR
    I = index * np.exp(-t / 0.35)
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * ratio * f * t))
    y += 0.25 * np.sin(2 * np.pi * 2.0 * f * t) * np.exp(-t / (dur * 0.2))
    e = np.exp(-t / (dur * 0.38))
    na = int(a * SR)
    e[:na] *= np.linspace(0, 1, na)
    return (y * e * 0.5).astype(F32)


@cached
def sub_note(m, dur, a=0.006, rel=0.08, h2=0.12, drive=1.3):
    f = mtof(m)
    n = int((dur + rel * 6) * SR)
    t, e = env(n, dur, a, rel)
    y = np.sin(2 * np.pi * f * t) + h2 * np.sin(4 * np.pi * f * t + 0.5)
    return (np.tanh(drive * y * e) * 0.8).astype(F32)


@cached
def kick(f0=44.0, drop=80.0, dtau=0.035, decay=0.32, click=0.0, drive=1.4):
    n = int(decay * 6 * SR)
    t = np.arange(n) / SR
    fr = f0 + drop * np.exp(-t / dtau)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    e = np.exp(-t / decay)
    e[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    y = np.sin(ph) * e
    if click:
        c = np.random.default_rng(7).standard_normal(n) * np.exp(-t / 0.004)
        fr2 = np.fft.rfftfreq(n, 1 / SR)
        y += click * np.fft.irfft(np.fft.rfft(c) * lpq(fr2, 2500, 0.7), n=n)
    return np.tanh(drive * y).astype(F32)


@cached
def noise_hit(var, tau=0.04, fc=6000, q=0.9, lp=9000, length=None, bursts=None, att=0.001):
    """대역 잡음 타격(셰이커·햇·클랩·스네어 몸통). var 번째 변형(결정적 시드)."""
    n = int((length or tau * 7) * SR)
    t = np.arange(n) / SR
    nz = np.random.default_rng(1000 + var).standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    nz = np.fft.irfft(np.fft.rfft(nz) * bpq(fr, fc, q) * lp_mag(fr, lp, 2), n=n)
    e = np.exp(-t / tau)
    if bursts:
        for d in bursts:
            e += 0.8 * np.exp(-np.maximum(t - d, 0) / 0.006) * (t >= d)
    na = max(1, int(att * SR))
    e[:na] *= np.linspace(0, 1, na)
    return (nz * e / (np.abs(nz).max() + 1e-9)).astype(F32)


@cached
def tone_hit(f0, decay=0.12, bend=0.0, btau=0.02, partials=((1.0, 1.0),), noise=0.0, nfc=3000, var=0):
    """음정 있는 타악(콩가·톰·카우벨·우드블록·림): 부분음 (배율, 진폭), 시작 음높이 bend 배 → 1."""
    n = int(decay * 7 * SR)
    t = np.arange(n) / SR
    fr = f0 * (1 + bend * np.exp(-t / btau))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    y = np.zeros(n)
    for r, a in partials:
        y += a * np.sin(r * ph + r)
    y *= np.exp(-t / decay)
    if noise:
        nz = noise_hit(var, 0.01, nfc, 0.8, 9000, length=(n + 2) / SR)[:n]
        y[: len(nz)] += noise * nz
    na = int(0.0008 * SR)
    y[:na] *= np.linspace(0, 1, na)
    return (y / (np.abs(y).max() + 1e-9)).astype(F32)


@cached
def riser(length, var=0, f0=700.0, f1=7000.0):
    """잡음 상승(빌드업 끝): 낮은 대역 → 높은 대역으로 옮겨 가며 커진다."""
    n = int(length * SR)
    t = np.arange(n) / SR
    nz = np.random.default_rng(3000 + var).standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    X = np.fft.rfft(nz)
    lo = np.fft.irfft(X * bpq(fr, f0, 0.8), n=n)
    hi = np.fft.irfft(X * bpq(fr, f1, 0.8), n=n)
    w = (t / length) ** 1.5
    y = (lo * (1 - w) + hi * w) * w
    y[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return (y / (np.abs(y).max() + 1e-9)).astype(F32)


def snare(var=0, tone=190, tau=0.11, body=0.6, fc=3500, q=0.6):
    k = ("snare", var, tone, tau, body, fc, q)
    if k not in _NC:
        nz = noise_hit(var, tau, fc, q, 9000)
        n = len(nz)
        t = np.arange(n) / SR
        y = nz + body * np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.05)
        _NC[k] = (y / np.abs(y).max()).astype(F32)
    return _NC[k]


def clap(var=0):
    return noise_hit(var, 0.07, 1400, 0.9, 7000, length=0.45, bursts=(0.0, 0.011, 0.023))


def hat(var=0, open_=False):
    return noise_hit(var, 0.16 if open_ else 0.022, 8500, 0.7, 12000) * F32(2.5)


def shaker(var=0):
    return noise_hit(var, 0.035, 5500, 0.8, 9000, att=0.012) * F32(2.5)


@cached
def additive(f, dur, v, ratios, amps, taus, att=0.005, rel=0.08, vib=0.0, vib_rate=5.5, vib_delay=0.25,
             hmax=7000.0, att_spread=0.0, tail=0.0):
    n = int((dur + rel + tail) * SR) + 1
    t = np.arange(n) / SR
    if vib > 0:
        ramp = np.clip((t - vib_delay) / 0.3, 0, 1)
        inst = 1.0 + vib * ramp * np.sin(2 * np.pi * vib_rate * t)
        base = 2 * np.pi * f * np.cumsum(inst) / SR
    else:
        base = 2 * np.pi * f * t
    y = np.zeros(n)
    for k, (r, a, tau) in enumerate(zip(ratios, amps, taus)):
        if f * r >= hmax or a <= 0:
            continue
        e = np.exp(-t / tau) if tau else 1.0
        at = 1 - np.exp(-t / (att * (1 + att_spread * k)))
        y += a * e * at * np.sin(r * base + 0.7 * k)
    y *= _gate(t, dur + tail, rel) * v
    return y.astype(F32)


def _t(x):
    return tuple(float(round(v, 5)) for v in x)


def nylon(f, dur, v):
    K = np.arange(1, 13)
    amps = np.abs(np.sin(np.pi * K * 0.17)) / K ** 1.1 * (0.55 + 0.45 * v) ** (K - 1)
    taus = 2.4 * (196.0 / f) ** 0.35 / (1 + 0.5 * (K - 1))
    return additive(f, dur, v, _t(K * np.sqrt(1 + 0.00004 * K * K)), _t(amps), _t(taus), att=0.0015, rel=0.12)


def steelgtr(f, dur, v):
    K = np.arange(1, 16)
    amps = np.abs(np.sin(np.pi * K * 0.11)) / K ** 0.85
    taus = 1.6 * (196.0 / f) ** 0.3 / (1 + 0.35 * (K - 1))
    return additive(f, dur, v, _t(K * np.sqrt(1 + 0.00003 * K * K)), _t(amps), _t(taus), att=0.001, rel=0.05, hmax=6500)


def skank(f, dur, v):
    """스카·레게 오프비트 기타(짧게 끊는 스트로크)."""
    K = np.arange(1, 12)
    amps = np.abs(np.sin(np.pi * K * 0.2)) / K ** 0.8
    return additive(f, dur, v, _t(K), _t(amps), _t(0.25 / (1 + 0.3 * (K - 1))), att=0.001, rel=0.02, hmax=5000)


def felt(f, dur, v):
    K = np.arange(1, 9)
    amps = 1.0 / K ** 1.9 * (0.5 + 0.5 * v) ** (K - 1)
    taus = 3.2 * (440.0 / f) ** 0.3 / (1 + 0.6 * (K - 1))
    return additive(f, dur, v, _t(K * np.sqrt(1 + 0.0002 * K * K)), _t(amps), _t(taus), att=0.006, rel=0.3, hmax=5000)


def piano(f, dur, v):
    """밝은 업라이트 피아노(몬투노·컴핑용)."""
    K = np.arange(1, 14)
    amps = 1.0 / K ** 1.3 * (0.45 + 0.55 * v) ** (K - 1)
    taus = 2.2 * (440.0 / f) ** 0.35 / (1 + 0.45 * (K - 1))
    return additive(f, dur, v, _t(K * np.sqrt(1 + 0.0003 * K * K)), _t(amps), _t(taus), att=0.002, rel=0.18, hmax=7000)


@cached
def epiano(f, dur, v, bark=1.0):
    n = int((dur + 0.25) * SR) + 1
    t = np.arange(n) / SR
    idx = (0.6 + 1.1 * v) * bark * np.exp(-t / 0.22) + 0.12
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    y += 0.12 * np.exp(-t / 0.08) * np.sin(2 * np.pi * f * 7.0 * t) * (f * 7 < 6000)
    y *= np.exp(-t / (2.0 * (262.0 / f) ** 0.4)) * (1 - np.exp(-t / 0.002)) * _gate(t, dur, 0.25) * v
    return y.astype(F32)


def upright(f, dur, v):
    return additive(f, dur, v, (1, 2, 3, 4, 5, 6), (1, 0.5, 0.22, 0.12, 0.06, 0.03), (1.3, 0.8, 0.5, 0.35, 0.25, 0.2),
                    att=0.007, rel=0.06)


def ebass(f, dur, v):
    """핑거 일렉 베이스(둥근 어택, 디스코·스카)."""
    return additive(f, dur, v, (1, 2, 3, 4, 5, 6, 7), (1, 0.6, 0.35, 0.2, 0.12, 0.07, 0.04),
                    (2.0, 1.0, 0.6, 0.4, 0.3, 0.2, 0.15), att=0.004, rel=0.05, hmax=3000)


def pizz(f, dur, v):
    K = np.arange(1, 9)
    return additive(f, dur, v, _t(K), _t(1.0 / K ** 1.4), _t(0.4 / (1 + 0.35 * (K - 1))), att=0.003, rel=0.08, hmax=5000)


def brass(f, dur, v, bright=0.6):
    K = np.arange(1, 16)
    p = 1.0 + 1.3 * (1 - bright * (0.6 + 0.4 * v))
    return additive(f, dur, v, _t(K), _t(1.0 / K ** p), _t(np.full(len(K), 2.5)), att=0.014, rel=0.09, vib=0.0035,
                    vib_rate=5.6, vib_delay=0.35, hmax=4800, att_spread=0.22)


def tuba(f, dur, v):
    K = np.arange(1, 9)
    return additive(f, dur, v, _t(K), _t(1.0 / K ** 1.8), _t(np.full(8, 1.6)), att=0.02, rel=0.08, hmax=1800, att_spread=0.2)


def sax(f, dur, v):
    K = np.arange(1, 14)
    amps = 1.0 / K ** 1.25 * (1 + 0.8 * np.exp(-((f * K - 1300) / 700.0) ** 2))
    return additive(f, dur, v, _t(K), _t(amps), _t(np.full(13, 3.0)), att=0.022, rel=0.08, vib=0.005, vib_rate=5.2,
                    vib_delay=0.3, hmax=4500, att_spread=0.1)


def clarinet(f, dur, v):
    K = np.arange(1, 12)
    amps = np.where(K % 2 == 1, 1.0 / K, 0.25 / K ** 2)
    return additive(f, dur, v, _t(K), _t(amps), _t(np.full(11, 3.0)), att=0.015, rel=0.06, vib=0.003, vib_rate=5.0,
                    vib_delay=0.4, hmax=4500)


def accordion(f, dur, v):
    """리드 두 벌(약간 디튠, 떨림) — 아코디언·멜로디카."""
    K = np.arange(1, 10)
    amps = 1.0 / K ** 1.05
    r = np.concatenate([K, K * 1.0035])
    a = np.concatenate([amps, amps * 0.8])
    return additive(f, dur, v, _t(r), _t(a), _t(np.full(len(r), 4.0)), att=0.02, rel=0.06, hmax=5000)


def flute(f, dur, v):
    return additive(f, dur, v, (1, 2, 3), (1, 0.22, 0.07), (0, 0, 0), att=0.045, rel=0.12, vib=0.006, vib_rate=4.8,
                    vib_delay=0.3, hmax=6000)


def strings(f, dur, v):
    """현악 합주(느린 어택·비브라토, 배음 1/k)."""
    K = np.arange(1, 14)
    r = np.concatenate([K, K * 1.004, K * 0.997])
    a = np.concatenate([1.0 / K ** 1.2] * 3) / 3
    return additive(f, dur, v, _t(r), _t(a), _t(np.zeros(len(r))), att=0.35, rel=0.6, vib=0.004, vib_rate=5.2,
                    vib_delay=0.2, hmax=6000)


def cello(f, dur, v):
    K = np.arange(1, 12)
    amps = 1.0 / K ** 1.1 * (1 + 0.7 * np.exp(-((f * K - 600) / 300.0) ** 2))
    return additive(f, dur, v, _t(K), _t(amps), _t(np.zeros(11)), att=0.25, rel=0.5, vib=0.004, vib_rate=5.0,
                    vib_delay=0.35, hmax=4000)


_FORMANTS = {"oo": ((300, 1.0), (870, 0.35), (2240, 0.12)), "ah": ((730, 1.0), (1090, 0.6), (2440, 0.2)),
             "oh": ((500, 1.0), (850, 0.5), (2500, 0.1))}


def choir(f, dur, v, vowel="oo", att=0.6, rel=1.2):
    """포먼트 합창(가산, 세 겹 디튠·느린 어택)."""
    K = np.arange(1, int(min(40, 4000 / f)) + 1)
    w = np.zeros(len(K))
    for fc, g in _FORMANTS[vowel]:
        w += g * np.exp(-((f * K - fc) / (0.35 * fc)) ** 2)
    w = w / (K ** 0.4) + 0.02 / K
    r = np.concatenate([K, K * 1.005, K * 0.995])
    a = np.concatenate([w] * 3) / 3
    return additive(f, dur, v, _t(r), _t(a), _t(np.zeros(len(r))), att=att, rel=rel, vib=0.003, vib_rate=4.6,
                    vib_delay=0.4, hmax=5000)


def xylo(f, dur, v):
    return additive(f, 0.02, v, (1, 3.93, 9.2), (1, 0.22, 0.05), (0.32, 0.07, 0.025), att=0.0008, rel=0.02, tail=0.6)


def marimba(f, dur, v):
    return additive(f, 0.02, v, (1, 3.99, 10.65), (1, 0.12, 0.03), (0.55, 0.09, 0.03), att=0.0015, rel=0.02, tail=1.0)


def vibes(f, dur, v):
    return additive(f, dur, v, (1, 4.0, 10.0), (1, 0.12, 0.03), (1.6, 0.35, 0.1), att=0.002, rel=0.3)


def musicbox(f, dur, v):
    return additive(f, 0.02, v, (1, 2.0, 3.01, 5.43, 8.9), (1, 0.35, 0.12, 0.08, 0.03), (1.4, 0.6, 0.3, 0.12, 0.05),
                    att=0.0006, rel=0.02, tail=2.0, hmax=9000)


def kalimba(f, dur, v):
    return additive(f, 0.02, v, (1, 5.9, 13.4), (1, 0.18, 0.05), (0.9, 0.08, 0.03), att=0.001, rel=0.02, tail=1.2)


def organ(f, dur, v):
    return additive(f, dur, v, (0.5, 1, 2, 3, 4), (0.45, 1.0, 0.55, 0.25, 0.18), (0, 0, 0, 0, 0), att=0.003, rel=0.04,
                    hmax=5000)


def square(f, dur, v):
    K = np.arange(1, 16, 2)
    return additive(f, dur, v, _t(K), _t(1.0 / K ** 1.2), _t(np.zeros(len(K))), att=0.004, rel=0.05, vib=0.004,
                    vib_rate=5.5, vib_delay=0.3, hmax=6000)


def blip(f, dur, v):
    """사인 텔레메트리 블립(짧고 맑음)."""
    return additive(f, dur, v, (1, 2), (1, 0.15), (0.12, 0.05), att=0.001, rel=0.02, tail=0.2)


INSTR = {"nylon": nylon, "steel": steelgtr, "skank": skank, "felt": felt, "piano": piano, "epiano": epiano,
         "upright": upright, "ebass": ebass, "pizz": pizz, "brass": brass, "brassd": lambda f, d, v: brass(f, d, v, 0.35),
         "tuba": tuba, "sax": sax, "clarinet": clarinet, "accordion": accordion, "flute": flute, "strings": strings, "cello": cello,
         "choir": choir, "choirah": lambda f, d, v: choir(f, d, v, "ah"),
         "voxchop": lambda f, d, v: choir(f, d, v, "ah", 0.012, 0.1), "xylo": xylo, "marimba": marimba,
         "vibes": vibes, "musicbox": musicbox, "kalimba": kalimba, "organ": organ, "square": square, "blip": blip}


def inst(name, m, dur, v=1.0):
    vq = max(0.05, round(v * 20) / 20)
    sig = INSTR[name](mtof(m), round(dur, 3), vq)
    return sig * F32(v / vq) if abs(v - vq) > 1e-6 else sig


# ───────────────────────── 질감(전체 길이) ─────────────────────────

def texture(kind, var=0):
    """원형 길이 N 의 배경 질감(스테레오): rain 빗소리·vinyl 바늘 잡음·wind 바람·hiss 테이프 쉿."""
    r = np.random.default_rng(5000 + var)
    f = freqs()
    out = np.zeros((2, N), dtype=F32)
    for ch in range(2):
        x = r.standard_normal(N).astype(F32)
        if kind == "rain":
            mag = bpq(f, 2500, 0.5) * lp_mag(f, 9000, 2) + 0.4 * bpq(f, 600, 0.7)
            y = fd_filter(x, mag)
            drops = np.zeros(N, dtype=F32)
            idx = r.integers(0, N, int(DUR * 35))
            drops[idx] = r.random(len(idx)).astype(F32) ** 2
            dr = fd_filter(drops, bpq(f, 3800, 1.5))
            y = y / (np.abs(y).max() + 1e-9) * 0.5 + dr / (np.abs(dr).max() + 1e-9)
        elif kind == "vinyl":
            y = fd_filter(x, bpq(f, 3000, 0.4) * lp_mag(f, 8000, 2)) * F32(0.25)
            cr = np.zeros(N, dtype=F32)
            idx = r.integers(0, N, int(DUR * 6))
            cr[idx] = (r.random(len(idx)) * 2 - 1).astype(F32)
            y = y / (np.abs(y).max() + 1e-9) * 0.3 + fd_filter(cr, hp_mag(f, 1500, 2))
        elif kind == "wind":
            y = fd_filter(x, bpq(f, 450, 0.6))
            tt = np.arange(N) / SR
            y *= (0.6 + 0.4 * np.sin(2 * np.pi * loopf(1 / 23.0) * tt + ch)).astype(F32)
        else:
            y = fd_filter(x, bpq(f, 6000, 0.5))
        out[ch] = y / (np.abs(y).max() + 1e-9)
    return out


# ───────────────────────── 층(layer)·렌더 ─────────────────────────

class Layer:
    """한 악기 층. 이름이 SECS 의 레벨 키(없으면 늘 1). sweep=(lo, hi) 면 sweep_key 섹션 곡선으로 필터가 열린다.
    trem=(박 단위 주기, 깊이) 템포 맞춤 트레몰로. duck = 킥 사이드체인 깊이."""

    def __init__(self, name, dry=0.8, rev=0.3, echo=0.0, lp=None, hp=None, duck=0.0, tau=1.5, sweep=None,
                 sweep_key="filt", width=1.0, gain=1.0, bp=None, trem=None, drive=0.0):
        self.name, self.dry, self.rev, self.echo = name, dry, rev, echo
        self.lp, self.hp, self.duck, self.tau, self.sweep, self.sweep_key = lp, hp, duck, tau, sweep, sweep_key
        self.width, self.gain, self.bp, self.trem, self.drive = width, gain, bp, trem, drive
        self.ev = []

    def add(self, t, sig, v=1.0, pan=0.0):
        self.ev.append((t, sig, v, pan))

    def note(self, t, name, m, dur, v=1.0, pan=0.0, jit=0.004):
        self.add(t + float(rng.normal(0, jit)) if jit else t, inst(name, m, dur, v), 1.0, pan)

    def hit(self, t, sig, v=1.0, pan=0.0, jit=0.003):
        self.add(t + float(rng.normal(0, jit)) if jit else t, sig, v, pan)

    def kick(self, t, sig, v=1.0, pan=0.0, duck=True):
        if duck:
            KICKS.append(t)
        self.add(t, sig, v, pan)


def pattern(L, bar, steps, sig_fn, v=1.0, pan=0.0, swing=0.0, sub=4, jit=0.003, kick=False):
    """한 마디 패턴 문자열: 'X' 1.0 · 'x' 0.75 · 'o' 0.45 · '.' 0.22 · '-' 쉼. sub = 박당 칸 수. swing = 짝수 칸 뒤로 미는 비율.
    sig_fn(i) → 신호(변형 고르기)."""
    acc = {"X": 1.0, "x": 0.75, "o": 0.45, ".": 0.22}
    for i, c in enumerate(steps):
        if c not in acc:
            continue
        beat = i / sub + (swing / sub if i % 2 == 1 else 0.0)
        t = tb(bar, beat)
        sig = sig_fn(i)
        if kick:
            L.kick(t, sig, v * acc[c], pan)
        else:
            L.hit(t, sig, v * acc[c], pan, jit)


def reverb_ir(length, rt60_lo, rt60_hi):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.02 * SR)
    fr = np.fft.rfftfreq(n, 1 / SR)
    for ch in range(2):
        spec = np.fft.rfft(rng.standard_normal(n))
        lo = np.fft.irfft(spec * lp_mag(fr, 1500, 1), n=n)
        hi = np.fft.irfft(spec * hp_mag(fr, 1500, 1), n=n)
        tail = lo * np.exp(-6.91 * t / rt60_lo) + hi * np.exp(-6.91 * t / rt60_hi)
        tail *= 1 - np.exp(-t / 0.05)
        ir[ch, pre:] = tail[: n - pre]
        for k, ms in enumerate((11, 17, 26, 37, 48, 63)):
            idx = int((ms + (4 if ch else 0)) * SR / 1000)
            if idx < n:
                ir[ch, idx] += 0.4 * (0.8 ** k) * (1 if (k + ch) % 2 else -1)
    ir[:, -int(0.2 * SR):] *= np.linspace(1, 0, int(0.2 * SR))[None, :]
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


def echo_ir(delay, fb=0.45, taps=8):
    n = int(delay * (taps + 1) * SR) + 16
    ir = np.zeros((2, n))
    for k in range(1, taps + 1):
        ir[(k + 1) % 2, int(k * delay * SR)] = fb ** (k - 1) * 0.6
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * lp_mag(fr, 2800, 1) * hp_mag(fr, 250, 1), n=n, axis=1)
    return ir.astype(F32)


def duck_env(release=0.16):
    m = int(release * 5 * SR)
    shape = np.exp(-np.arange(m) / (release * SR)).astype(F32)
    att = int(0.004 * SR)
    shape[:att] *= np.linspace(0, 1, att, dtype=F32)
    tmp = new_bus()
    one = np.stack([shape, shape])
    for t in KICKS:
        add(tmp, t, one)
    return np.minimum(tmp[0], 1.0)


def bus_rms(x):
    return 20 * math.log10(max(math.sqrt(float((x.astype(np.float64) ** 2).mean())), 1e-12))


def _biquad_mag(f, b, a):
    w = 2 * np.pi * f / SR
    z1 = np.exp(-1j * w)
    z2 = z1 * z1
    return np.abs((b[0] + b[1] * z1 + b[2] * z2) / (a[0] + a[1] * z1 + a[2] * z2))


def k_weight_mag(f):
    A = 10 ** (4.0 / 40)
    w0 = 2 * np.pi * 1500 / SR
    al = np.sin(w0) / (2 * (1 / np.sqrt(2)))
    c = np.cos(w0)
    b = [A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al), -2 * A * ((A - 1) + (A + 1) * c),
         A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al)]
    a = [(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al, 2 * ((A - 1) - (A + 1) * c),
         (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al]
    m1 = _biquad_mag(f, b, a)
    w0 = 2 * np.pi * 38 / SR
    al = np.sin(w0) / (2 * 0.5)
    c = np.cos(w0)
    m2 = _biquad_mag(f, [(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al])
    return m1 * m2


def loudness(x):
    n = x.shape[1]
    fr = np.fft.rfftfreq(n, 1 / SR)
    kw = np.fft.irfft(np.fft.rfft(x.astype(np.float64), axis=1) * k_weight_mag(fr), n=n, axis=1)
    sq = (kw ** 2).sum(axis=0)
    del kw
    cs = np.concatenate([[0.0], np.cumsum(sq)])
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    starts = np.arange(0, n - blk + 1, hop)
    if len(starts) == 0:
        return -120.0
    z = (cs[starts + blk] - cs[starts]) / blk
    L = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    z1 = z[L > -70]
    if len(z1) == 0:
        return -120.0
    rel = -0.691 + 10 * np.log10(z1.mean()) - 10
    z2 = z1[(-0.691 + 10 * np.log10(z1)) > rel]
    return float(-0.691 + 10 * np.log10(z2.mean()))


def sliding_min(x, w):
    h = w // 2
    xp = np.concatenate([x[-h:], x, x[: w]])
    m = len(xp)
    nb = -(-m // w)
    xp = np.concatenate([xp, np.full(nb * w - m, np.inf)])
    blocks = xp.reshape(nb, w)
    pre = np.minimum.accumulate(blocks, axis=1).ravel()
    suf = np.minimum.accumulate(blocks[:, ::-1], axis=1)[:, ::-1].ravel()
    i = np.arange(len(x))
    return np.minimum(suf[i], pre[i + w - 1])


def moving_avg(x, w):
    h = w // 2
    xp = np.concatenate([x[-h:], x, x[: w]])
    cs = np.concatenate([[0.0], np.cumsum(xp, dtype=np.float64)])
    i = np.arange(len(x))
    return (cs[i + w] - cs[i]) / w


def limiter(x, ceil):
    peak = np.abs(x).max(axis=0).astype(np.float64)
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-12))
    if need.min() >= 1.0:
        return x, 0.0
    w = 1024
    g = np.minimum(moving_avg(sliding_min(need, 2 * w + 1), w), 1.0)
    return (x * g[None, :]).astype(F32), float(20 * np.log10(g.min()))


def render(layers, log=print):
    t0 = time.time()
    st = lambda msg: log(f"  [{time.time() - t0:5.1f}s] {msg}")
    f = freqs()
    dry, rev, echo = new_bus(), new_bus(), new_bus()
    kenv = duck_env() if KICKS else None
    stats = {}
    tt = None
    for L in layers:
        if not L.ev:
            continue
        bus = new_bus()
        for (t, sig, v, pan) in L.ev:
            add(bus, t, sig * F32(v) if v != 1.0 else sig, pan)
        hpm = hp_mag(f, L.hp, 1) if L.hp else 1.0
        if L.sweep:
            lo_fc, hi_fc = L.sweep
            lo = fd_filter(bus, lpq(f, lo_fc, 0.9) * hpm)
            bus = fd_filter(bus, lpq(f, hi_fc, 0.9) * hpm)
            if tt is None:
                tt = np.arange(N, dtype=np.float64) / SR
            w = section_curve(L.sweep_key, 0.3, tau=6.0) + F32(0.08) * np.sin(2 * np.pi * loopf(1 / (16 * BAR)) * tt).astype(F32)
            w = np.clip(w, 0, 1)[None, :]
            bus = lo + (bus - lo) * w
            del lo, w
        elif L.lp or L.hp or L.bp:
            mag = (lpq(f, L.lp, 0.7) if L.lp else 1.0) * hpm * (bpq(f, L.bp[0], L.bp[1]) if L.bp else 1.0)
            bus = fd_filter(bus, mag)
        if L.drive:
            bus = (np.tanh(F32(1 + L.drive) * bus * F32(4)) / F32(4)).astype(F32)
        bus *= section_curve(L.name, 0.0, tau=L.tau)[None, :] * F32(L.gain)
        if L.trem:
            if tt is None:
                tt = np.arange(N, dtype=np.float64) / SR
            per, depth = L.trem
            bus *= (1 - F32(depth) * (0.5 + 0.5 * np.sin(2 * np.pi * tt / (per * BEAT)))).astype(F32)[None, :]
        if L.duck and kenv is not None:
            bus *= (1 - F32(L.duck) * kenv)[None, :]
        if L.width != 1.0:
            mid = (bus[0] + bus[1]) * F32(0.5)
            side = (bus[0] - bus[1]) * F32(0.5 * L.width)
            bus[0], bus[1] = mid + side, mid - side
            del mid, side
        stats[L.name] = bus_rms(bus)
        if L.dry:
            dry += F32(L.dry) * bus
        if L.rev:
            rev += F32(L.rev) * bus
        if L.echo:
            echo += F32(L.echo) * bus
        del bus
        st(f"{L.name}: {len(L.ev)}음")
    del tt
    if np.any(echo):
        ec = circ_conv(echo.mean(axis=0), echo_ir(ECHO_BEATS * BEAT, ECHO_FB))
        dry += F32(0.55) * ec
        rev += F32(0.4) * ec
        del ec
    del echo
    wet = circ_conv(rev, reverb_ir(*REVERB))
    del rev
    wet = fd_filter(wet, hp_mag(f, 150, 1) * lpq(f, 4000, 0.7))
    mid = (wet[0] + wet[1]) * F32(0.5)
    side = (wet[0] - wet[1]) * F32(0.5 * 1.3)
    wet[0], wet[1] = mid + side, mid - side
    del mid, side
    dry += F32(WET) * wet
    del wet
    st("echo·reverb")
    log("  층 RMS(dBFS): " + ", ".join(f"{k} {v:.1f}" for k, v in stats.items()))
    mix = fd_filter(dry, hp_mag(f, 24, 2) * lpq(f, MASTER_LP, 0.7) * shelf_mag(f, 6500, HI_SHELF))
    del dry
    lufs0 = loudness(mix)
    mix *= F32(10 ** ((TARGET_LUFS - lufs0) / 20))
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
    for _ in range(3):
        l1 = loudness(mix)
        if abs(l1 - TARGET_LUFS) < 0.2:
            break
        mix *= F32(10 ** ((TARGET_LUFS - l1) / 20))
        mix, gr2 = limiter(mix, ceil)
        gr = min(gr, gr2)
    pk = float(np.abs(mix).max())
    if pk > ceil:
        mix *= F32(ceil / pk)
    st(f"master (limiter max GR {gr:.2f} dB)")
    return mix, gr


# ───────────────────────── 인코딩·검사 ─────────────────────────

def to_int16(x):
    d = (rng.random(x.shape, dtype=F32) - rng.random(x.shape, dtype=F32))
    return np.clip(np.round(x * F32(32767.0) + d), -32768, 32767).astype(np.int16)


def encode_mp3(pcm16):
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(BITRATE)
    enc.set_in_sample_rate(SR)
    enc.set_channels(2)
    enc.set_quality(2)
    return bytes(enc.encode(np.ascontiguousarray(pcm16.T).tobytes())) + bytes(enc.flush())


def mp3_frames(data):
    br_tab = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    sr_tab = [44100, 48000, 32000, 0]
    i, frames, sr, brs = 0, 0, SR, set()
    if data[:3] == b"ID3":
        i = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9])
    while i + 4 <= len(data):
        h = data[i:i + 4]
        if h[0] != 0xFF or (h[1] & 0xE0) != 0xE0:
            i += 1
            continue
        br = br_tab[(h[2] >> 4) & 0xF] * 1000
        sr = sr_tab[(h[2] >> 2) & 3]
        if br == 0 or sr == 0:
            i += 1
            continue
        frames += 1
        brs.add(br)
        i += 144 * br // sr + ((h[2] >> 1) & 1)
    return frames, frames * 1152 / sr, brs


def db(v):
    return 20 * math.log10(max(v, 1e-12))


def metrics(x):
    """비교용 지표: 스펙트럼 중심, 저역(<200 Hz)·중역 에너지 흐름, 50ms RMS 변동, 8kHz 위 비율, 박 주기 자기상관."""
    mono = x.mean(axis=0).astype(np.float64)
    nfft, hop = 2048, 1024
    nfr = (len(mono) - nfft) // hop
    win = np.hanning(nfft)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    cen, lowE, midE, hiE, tot = [], [], [], [], []
    for c0 in range(0, nfr, 1024):
        idx = np.arange(c0, min(nfr, c0 + 1024))[:, None] * hop + np.arange(nfft)[None, :]
        P = np.abs(np.fft.rfft(mono[idx] * win, axis=1)) ** 2
        cen.append((P * fr).sum(1) / (P.sum(1) + 1e-20))
        lowE.append(P[:, fr < 200].sum(1))
        midE.append(P[:, (fr >= 200) & (fr < 5000)].sum(1))
        hiE.append(P[:, fr >= 8000].sum(1))
        tot.append(P.sum(1))
    cen, lowE, midE, hiE, tot = map(np.concatenate, (cen, lowE, midE, hiE, tot))
    fl = lambda e: float(np.maximum(np.diff(10 * np.log10(e + 1e-12)), 0).mean())
    w = int(0.05 * SR)
    r = np.sqrt((mono[: len(mono) // w * w].reshape(-1, w) ** 2).mean(1))
    rdb = 20 * np.log10(r + 1e-9)
    return {"centroid_hz": round(float(np.median(cen)), 1), "flux_low": round(fl(lowE), 3), "flux_mid": round(fl(midE), 3),
            "rms50_std_db": round(float(rdb.std()), 2), "hf8k_db": round(float(10 * np.log10(hiE.sum() / tot.sum())), 1)}


def check(x, info):
    x64 = x.astype(np.float64)
    tot_pk = db(float(np.abs(x64).max()))
    tot_lu = loudness(x)
    e, b = x64[:, -SR:], x64[:, :SR]
    jump = float(np.abs(b[:, 0] - e[:, -1]).max())
    typ = float(np.abs(np.diff(b, axis=1)).max())
    win = int(15 * SR)
    curve = [round(db(math.sqrt((x64[:, i:i + win] ** 2).mean())), 1) for i in range(0, N - win + 1, win)]
    r = {"lufs": round(tot_lu, 2), "peak_dbfs": round(tot_pk, 2), "mp3_secs": round(info["secs"], 3),
         "mp3_bytes": info["size"], "cbr": sorted(b_ // 1000 for b_ in info["brs"]), "sha256": info["sha"],
         "seam_jump": round(jump, 5), "seam_typ_maxdiff": round(typ, 5),
         "rms_first1s": round(db(math.sqrt((b ** 2).mean())), 2), "rms_last1s": round(db(math.sqrt((e ** 2).mean())), 2),
         "clip_samples": int((np.abs(x64) >= 1.0).sum()), "rms15_curve": curve}
    r.update(metrics(x))
    ok = (abs(info["secs"] - DUR) <= 0.5 and info["size"] <= 8 * 1024 * 1024 and tot_pk <= CEIL_DB + 0.01
          and abs(tot_lu - TARGET_LUFS) <= 0.5 and info["brs"] == {BITRATE * 1000} and jump <= max(3 * typ, 0.02)
          and r["clip_samples"] == 0)
    r["ok"] = bool(ok)
    return ok, r


def run(build, argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=f"'{TITLE}' BGM 합성")
    ap.add_argument("--out", default=f"bgm-{TRACK_ID}.mp3", help="MP3 출력 경로(같은 폴더에 json·report-<id>.json)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV(선택)")
    args = ap.parse_args(argv)
    t0 = time.time()
    print(f"합성 시작: {TRACK_ID} {BPM} BPM {BEATS}/4, {BARS}마디, {DUR:.3f}초, seed {SEED}")
    layers = build()
    print(f"  사건 {sum(len(L.ev) for L in layers):,}개, 킥 {len(KICKS)}")
    mix, gr = render(layers)
    pcm = to_int16(mix)
    out = os.path.abspath(args.out)
    outdir = os.path.dirname(out)
    os.makedirs(outdir, exist_ok=True)
    if args.wav:
        import wave
        with wave.open(args.wav, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(np.ascontiguousarray(pcm.T).tobytes())
    mp3 = encode_mp3(pcm)
    with open(out, "wb") as fh:
        fh.write(mp3)
    meta = {"title": TITLE, "mood": MOOD, "stage": STAGE, "energy": ENERGY, "duration": int(round(DUR)),
            "bpm": BPM, "key": KEY_NAME, "meter": f"{BEATS}/4",
            "sections": [{"name": s["n"], "part": s["part"], "start": round(tb(s["start"]), 3)} for s in SECS],
            "seed": SEED}
    with open(os.path.splitext(out)[0] + ".json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs, brs = mp3_frames(mp3)
    info = dict(frames=frames, secs=secs, brs=brs, size=len(mp3), sha=hashlib.sha256(mp3).hexdigest())
    ok, rep = check(mix, info)
    rep["limiter_gr_db"] = round(gr, 2)
    rep["wall_s"] = round(time.time() - t0, 1)
    rep["bpm"], rep["key"], rep["meter"] = BPM, KEY_NAME, f"{BEATS}/4"
    with open(os.path.join(outdir, f"report-{TRACK_ID}.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "rms15_curve"}, ensure_ascii=False))
    print("  15초 창 RMS:", rep["rms15_curve"])
    print("검사:", "통과" if ok else "실패")
    return 0 if ok else 1
