#!/usr/bin/env python3
"""'워프 항해' 시네마틱 스페이스 드라이브 BGM 결정적 합성기 (활동 단계 3 · 매우 활발, Planet 표현).

128 BPM 16분 롤링 옥타브 베이스 시퀀서, 3음 주기로 엇갈리는 플럭 아르페지오(점 8분 에코), 넓은 7성부 슈퍼소 패드,
부드러운 4분 킥·2·4박 클랩·오프비트 햇·셰이커, 구간 전환마다 깊은 임팩트와 잡음 상승음, 브레이크·클라이맥스의 느린 신스 주제.
D 마이너(i–VI–III–VII), 고음은 마스터 8.5 kHz 저역통과로 눌러 귀가 피로하지 않게.
128 BPM 4/4 160마디 = 정확히 300초. 처음과 끝은 같은 패드 + 옅은 아르페지오(루프).
  인트로(0～16) → 빌드업(16～32) 베이스·셰이커 → 그루브(32～64) 킥·클랩 → 브레이크(64～80) 주제
  → 클라이맥스(80～112) 전부 + 주제 → 정리(112～144) → 아웃트로(144～160) 처음 상태로

사용법:
  python compose_warp.py --out bgm-warp.mp3 [--wav 미리듣기.wav]
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

TRACK_ID = "warp"
SEED = 2026
BPM = 128
TITLE = "워프 항해"
MOOD = "시네마틱 스페이스 드라이브 · 16분 롤링 베이스 시퀀서, 엇갈리는 플럭 아르페지오, 넓은 슈퍼소 패드, 부드러운 킥·클랩, 장엄한 신스 주제"
KEY_NAME = "D minor"
STAGE = 3
ENERGY = 0.85
REVERB = (5.0, 4.2, 1.8)
WET = 0.5
ECHO_BEATS = 0.75
MASTER_LP = 8500
_D = {"kick": 1.0, "clap": 1.0, "hat": 1.0, "shaker": 1.0, "bass": 1.0}
SECS = [
    {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.7, "shaker": 0.6, "boom": 1.0, "filt": 0.2},
    {"n": "빌드업", "part": "승", "bars": 16, "pad": 1.0, "arp": 0.8, "bass": 0.8, "shaker": 0.8, "boom": 1.0, "filt": 0.45},
    {"n": "그루브", "part": "승", "bars": 32, "pad": 1.0, "arp": 1.0, **_D, "boom": 1.0, "filt": 0.6},
    {"n": "브레이크", "part": "전", "bars": 16, "pad": 1.0, "arp": 0.7, "theme": 0.8, "boom": 1.0, "filt": 0.5},
    {"n": "클라이맥스", "part": "전", "bars": 32, "pad": 1.0, "arp": 1.0, **_D, "theme": 1.0, "boom": 1.0, "filt": 1.0},
    {"n": "정리", "part": "결", "bars": 32, "pad": 1.0, "arp": 0.9, **_D, "boom": 1.0, "filt": 0.6},
    {"n": "아웃트로", "part": "결", "bars": 16, "pad": 1.0, "arp": 0.7, "shaker": 0.6, "boom": 1.0, "filt": 0.2},
]
for _s in SECS:
    _s["riser"] = 1.0
# 4마디씩: Dm(add9) – Bbmaj7 – Fadd9 – Csus2 (베이스 근음, 패드 음, 아르페지오 음)
PROG = [(38, [50, 57, 62, 65, 69], [62, 65, 69, 74, 76]), (34, [50, 58, 62, 65, 69], [62, 65, 70, 74, 77]),
        (41, [53, 57, 60, 65, 67], [65, 67, 69, 72, 77]), (36, [52, 55, 60, 62, 67], [62, 64, 67, 72, 74])]
BPAT = [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 7, 12, 0, 12]
APAT = [0, 2, 1, 3, 2, 4]
THEME = [(0, 69, 8), (8, 74, 8), (16, 74, 6), (22, 72, 2), (24, 70, 8), (32, 72, 8), (40, 77, 8), (48, 76, 12), (60, 74, 4)]
RISERS = [28, 76, 108]           # 4마디 잡음 상승 → 다음 구간
BOOMS = [32, 64, 80, 112]


def chord(bar):
    return PROG[(bar // 4) % len(PROG)]


def riser(dur):
    n = int((dur + 0.4) * SR)
    t = np.arange(n) / SR
    nz = np.random.default_rng(SEED + 9).standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    lo = np.fft.irfft(np.fft.rfft(nz) * bpq(fr, 700, 0.8), n=n)
    hi = np.fft.irfft(np.fft.rfft(nz) * bpq(fr, 3200, 0.8) * lp_mag(fr, 6000, 2), n=n)
    x = np.clip(t / dur, 0, 1)
    e = x ** 2.2 * np.where(t > dur, np.exp(-(t - dur) / 0.06), 1.0)
    y = (lo * (1 - x) + hi * x) * e
    return (y / np.abs(y).max()).astype(F32)


def build():
    pad = Layer("pad", dry=0.6, rev=0.5, hp=120, sweep=(600, 3000), width=1.4, duck=0.35, tau=3.0)
    bass = Layer("bass", dry=1.0, rev=0.05, lp=1800, duck=0.5, tau=1.0)
    arp = Layer("arp", dry=0.5, rev=0.35, echo=0.35, lp=4200, hp=250, duck=0.2, tau=2.0)
    kk = Layer("kick", dry=1.0, rev=0.04, lp=2500, tau=0.3)
    clap = Layer("clap", dry=0.6, rev=0.45, lp=5000, hp=500, tau=0.3)
    hat = Layer("hat", dry=0.6, rev=0.2, lp=8500, hp=3500, tau=0.5)
    shk = Layer("shaker", dry=0.6, rev=0.2, lp=8000, hp=2500, tau=1.0)
    theme = Layer("theme", dry=0.5, rev=0.6, echo=0.15, lp=3400, hp=200, duck=0.15, tau=3.0)
    boom = Layer("boom", dry=0.8, rev=0.7, lp=900, tau=0.5)
    rise = Layer("riser", dry=0.5, rev=0.5, lp=7000, hp=300, tau=0.5)
    for bar in range(0, BARS, 4):
        root, pnotes, anotes = chord(bar)
        for m in pnotes:
            pad.add(tb(bar), pad_note(m, 4 * BAR + 0.2, a=1.2, rel=2.0, voices=7, cents=18.0, width=0.9), 0.25)
    for bar in RISERS:
        rise.add(tb(bar), riser(4 * BAR), 0.35)
    for bar in BOOMS:
        boom.add(tb(bar), kick(34.0, 30.0, 0.08, 1.1), 0.8)
    ph = 2 * math.pi / 32
    for bar in range(BARS):
        root, pnotes, anotes = chord(bar)
        oct_f = lv("filt", bar) * 1.8 + 0.3 * math.sin(ph * bar)
        fcb = int(380 * 2 ** (round(oct_f * 4) / 4))
        if lv("bass", bar) > 0:
            for i, off in enumerate(BPAT):
                bass.add(tb(bar, i * 0.25), saw_note(root + off, BEAT * 0.18, fcb * (1.2 if i % 4 == 2 else 1.0), 140,
                                                     tau=0.05, a=0.002, rel=0.03, kmax=32), 0.62 if i % 4 == 0 else 0.5)
        fca = int(1500 * 2 ** (round(oct_f * 4) / 4))
        for i in range(16):
            k = bar * 16 + i
            m = anotes[APAT[k % len(APAT)]]
            arp.add(tb(bar, i * 0.25), saw_note(m, BEAT * 0.15, fca, 400, tau=0.07, a=0.002, rel=0.05, kmax=24),
                    0.42 if i % 3 == 0 else 0.28, pan=0.35 if k % 2 else -0.35)
        if lv("kick", bar) > 0:
            for bt in range(4):
                KICKS.append(tb(bar, bt))
                kk.add(tb(bar, bt), kick(48.0, 75.0, 0.03, 0.24, click=0.15), 0.5)
        if lv("clap", bar) > 0:
            for bt in (1, 3):
                clap.add(tb(bar, bt), noise_hit(20 + bt, tau=0.09, fc=1300, q=0.8, lp=5000, bursts=(0.011, 0.022)), 0.55)
        if lv("hat", bar) > 0:
            for bt in range(4):
                hat.add(tb(bar, bt + 0.5), noise_hit(bt, tau=0.055, fc=7500, q=0.7, lp=9000), 0.9, pan=0.2)
        if lv("shaker", bar) > 0:
            for i in range(16):
                shk.add(tb(bar, i * 0.25), noise_hit(4 + i % 4, tau=0.016, fc=5500, q=0.9, lp=8500),
                        0.55 if i % 4 == 2 else 0.32, pan=-0.3)
        if lv("theme", bar) > 0 and bar % 16 == 0:
            for (b, m, d) in THEME:
                theme.add(tb(bar, b), pad_note(m, d * BEAT, a=0.35, rel=1.0, voices=3, cents=7.0, width=0.4), 0.5)
    return [pad, bass, arp, kk, clap, hat, shk, theme, boom, rise]

# ═════════════════════════ 공통 엔진(Planet 묶음 compose_stardust·nebula·berlin·warp 동일) ═════════════════════════
# 원형 버퍼(정확히 300초) 합성: 끝을 넘는 꼬리·리버브·에코는 앞머리로 감긴다. 섹션 레벨 곡선도 원형으로 정상 상태를 맞춤.
# 측정·마스터링(K 가중 게이트 LUFS 근사·룩어헤드 리미터·TPDF 디더)은 music/compose_orbit.py 와 같은 방식.

F32 = np.float32
SR = 44100
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
BEAT = 60.0 / BPM
BAR = 4 * BEAT
BARS = sum(s["bars"] for s in SECS)
_b = 0
for _s in SECS:
    _s["start"] = _b
    _b += _s["bars"]
DUR = BARS * BAR
N = int(round(DUR * SR))
assert abs(DUR - 300.0) < 1e-6, DUR
rng = np.random.default_rng(SEED)


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
    n = sig.shape[1]
    i0 = int(round(t0 * SR)) % N
    end = i0 + n
    if end <= N:
        buf[:, i0:end] += sig
    else:
        k = N - i0
        buf[:, i0:] += sig[:, :k]
        buf[:, : n - k] += sig[:, k:]


_FREQ = None


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


def fd_filter(x, mag):
    X = np.fft.rfft(x, axis=-1)
    X *= mag.astype(X.real.dtype)
    return np.fft.irfft(X, n=N, axis=-1).astype(F32)


def circ_conv(x, ir):
    out = np.zeros((2, N), dtype=F32)
    xs = x if x.ndim == 2 else np.stack([x, x])
    for ch in range(2):
        h = np.zeros(N, dtype=F32)
        h[: ir.shape[1]] = ir[ch]
        out[ch] = np.fft.irfft(np.fft.rfft(xs[ch]) * np.fft.rfft(h), n=N).astype(F32)
    return out


def sec_at(bar):
    for s in SECS:
        if s["start"] <= bar < s["start"] + s["bars"]:
            return s
    return SECS[-1]


def lv(key, bar):
    return sec_at(bar).get(key, 0.0)


def section_curve(key, default=0.0, tau=2.0):
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


# ───────────────────────── 음원 ─────────────────────────

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


_NC = {}


def saw_note(m, dur, fc0, fc1=None, tau=0.15, a=0.004, rel=0.06, odd=False, kmax=48):
    """가산 합성 톱니(odd=True 면 사각): 배음마다 시간 변화 2차 저역통과 크기를 곱해 필터 엔벨로프를 흉내. 결정적 위상, 캐시."""
    fc1 = fc0 * 0.3 if fc1 is None else fc1
    key = ("saw", round(m, 2), round(dur, 3), int(fc0), int(fc1), round(tau, 3), a, rel, odd)
    if key in _NC:
        return _NC[key]
    f = mtof(m)
    n = int((dur + rel * 6) * SR)
    t, e = env(n, dur, a, rel)
    fc = fc1 + (fc0 - fc1) * np.exp(-t / tau)
    y = np.zeros(n)
    for k in range(1, int(min(kmax, 8500 / f)) + 1):
        if odd and k % 2 == 0:
            continue
        g = 1.0 / np.sqrt(1.0 + (k * f / fc) ** 4)
        y += (g / k) * np.sin(2 * np.pi * k * f * t + 0.7 * k)
    out = (y * e * 0.6).astype(F32)
    _NC[key] = out
    return out


def pad_note(m, dur, a=2.5, rel=3.0, voices=5, cents=11.0, width=0.8):
    """디튠 톱니 패드(표 조회). 스테레오."""
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


def bell(m, dur=2.5, index=1.4, ratio=2.0, a=0.003):
    key = ("bell", round(m, 2), dur, index, ratio)
    if key in _NC:
        return _NC[key]
    f = mtof(m)
    n = int(dur * 1.6 * SR)
    t = np.arange(n) / SR
    I = index * np.exp(-t / 0.35)
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * ratio * f * t))
    y += 0.25 * np.sin(2 * np.pi * 2.0 * f * t) * np.exp(-t / (dur * 0.2))
    e = np.exp(-t / (dur * 0.38))
    na = int(a * SR)
    e[:na] *= np.linspace(0, 1, na)
    out = (y * e * 0.5).astype(F32)
    _NC[key] = out
    return out


def sub_note(m, dur, a=0.006, rel=0.08, h2=0.12):
    key = ("sub", round(m, 2), round(dur, 3), a, rel, h2)
    if key in _NC:
        return _NC[key]
    f = mtof(m)
    n = int((dur + rel * 6) * SR)
    t, e = env(n, dur, a, rel)
    y = np.sin(2 * np.pi * f * t) + h2 * np.sin(4 * np.pi * f * t + 0.5)
    out = np.tanh(1.3 * y * e).astype(F32) * F32(0.8)
    _NC[key] = out
    return out


def kick(f0=44.0, drop=80.0, dtau=0.035, decay=0.32, click=0.0):
    key = ("kick", f0, drop, dtau, decay, click)
    if key in _NC:
        return _NC[key]
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
    out = np.tanh(1.4 * y).astype(F32)
    _NC[key] = out
    return out


def noise_hit(var, tau=0.04, fc=6000, q=0.9, lp=9000, length=None, bursts=None):
    """대역 잡음 타격(셰이커·햇·클랩). var 번째 변형(결정적 시드), 캐시."""
    key = ("nz", var, tau, fc, q, lp, length, bursts)
    if key in _NC:
        return _NC[key]
    n = int((length or tau * 7) * SR)
    t = np.arange(n) / SR
    nz = np.random.default_rng(1000 + var).standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    nz = np.fft.irfft(np.fft.rfft(nz) * bpq(fr, fc, q) * lp_mag(fr, lp, 2), n=n)
    e = np.exp(-t / tau)
    if bursts:
        for d in bursts:
            e += 0.8 * np.exp(-np.maximum(t - d, 0) / 0.006) * (t >= d)
    na = int(0.001 * SR)
    e[:na] *= np.linspace(0, 1, na)
    out = (nz * e / (np.abs(nz).max() + 1e-9)).astype(F32)
    _NC[key] = out
    return out


# ───────────────────────── 층(layer)·렌더 ─────────────────────────

class Layer:
    def __init__(self, name, dry=0.8, rev=0.3, echo=0.0, lp=None, hp=None, duck=0.0, tau=1.5, sweep=None, width=1.0, gain=1.0):
        self.name, self.dry, self.rev, self.echo = name, dry, rev, echo
        self.lp, self.hp, self.duck, self.tau, self.sweep, self.width, self.gain = lp, hp, duck, tau, sweep, width, gain
        self.ev = []

    def add(self, t, sig, v=1.0, pan=0.0):
        self.ev.append((t, sig, v, pan))


KICKS = []


def reverb_ir(length, rt60_lo, rt60_hi):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.03 * SR)
    fr = np.fft.rfftfreq(n, 1 / SR)
    for ch in range(2):
        spec = np.fft.rfft(rng.standard_normal(n))
        lo = np.fft.irfft(spec * lp_mag(fr, 1500, 1), n=n)
        hi = np.fft.irfft(spec * hp_mag(fr, 1500, 1), n=n)
        tail = lo * np.exp(-6.91 * t / rt60_lo) + hi * np.exp(-6.91 * t / rt60_hi)
        tail *= 1 - np.exp(-t / 0.08)
        ir[ch, pre:] = tail[: n - pre]
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
    """킥 시점마다 1→0 으로 풀리는 사이드체인 트리거(원형)."""
    k = np.zeros(N, dtype=F32)
    m = int(release * 5 * SR)
    shape = np.exp(-np.arange(m) / (release * SR)).astype(F32)
    att = int(0.004 * SR)
    shape[:att] *= np.linspace(0, 1, att, dtype=F32)
    one = np.stack([shape, shape])
    tmp = new_bus()
    for t in KICKS:
        add(tmp, t, one)
    k = np.minimum(tmp[0], 1.0)
    return k


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
    z = (cs[starts + blk] - cs[starts]) / blk
    L = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    z1 = z[L > -70]
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
            tt = np.arange(N, dtype=np.float64) / SR
            w = section_curve("filt", 0.3, tau=6.0) + F32(0.1) * np.sin(2 * np.pi * loopf(1 / (16 * BAR)) * tt).astype(F32)
            del tt
            w = np.clip(w, 0, 1)[None, :]
            bus = lo + (bus - lo) * w
            del lo, w
        elif L.lp or L.hp:
            mag = (lpq(f, L.lp, 0.7) if L.lp else 1.0) * hpm
            bus = fd_filter(bus, mag)
        bus *= section_curve(L.name, 0.0, tau=L.tau)[None, :] * F32(L.gain)
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
    if np.any(echo):
        ec = circ_conv(echo.mean(axis=0), echo_ir(ECHO_BEATS * BEAT))
        dry += F32(0.55) * ec
        rev += F32(0.4) * ec
        del ec
    del echo
    wet = circ_conv(rev, reverb_ir(*REVERB))
    del rev
    wet = fd_filter(wet, hp_mag(f, 150, 1) * lpq(f, 3500, 0.7))
    mid = (wet[0] + wet[1]) * F32(0.5)
    side = (wet[0] - wet[1]) * F32(0.5 * 1.3)
    wet[0], wet[1] = mid + side, mid - side
    del mid, side
    dry += F32(WET) * wet
    del wet
    st("echo·reverb")
    log("  층 RMS(dBFS): " + ", ".join(f"{k} {v:.1f}" for k, v in stats.items()))
    mix = fd_filter(dry, hp_mag(f, 24, 2) * lpq(f, MASTER_LP, 0.7))
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
    """단계 에너지 비교용 간단 지표: 스펙트럼 중심, 저역(<200 Hz)·중역 에너지 흐름(양의 변화량 평균), 50ms RMS 변동."""
    mono = x.mean(axis=0).astype(np.float64)
    nfft, hop = 2048, 1024
    nfr = (len(mono) - nfft) // hop
    win = np.hanning(nfft)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    cen, lowE, midE = [], [], []
    for c0 in range(0, nfr, 1024):
        idx = np.arange(c0, min(nfr, c0 + 1024))[:, None] * hop + np.arange(nfft)[None, :]
        P = np.abs(np.fft.rfft(mono[idx] * win, axis=1)) ** 2
        cen.append((P * fr).sum(1) / (P.sum(1) + 1e-20))
        lowE.append(P[:, fr < 200].sum(1))
        midE.append(P[:, (fr >= 200) & (fr < 5000)].sum(1))
    cen, lowE, midE = map(np.concatenate, (cen, lowE, midE))
    fl = lambda e: float(np.maximum(np.diff(10 * np.log10(e + 1e-12)), 0).mean())
    w = int(0.05 * SR)
    r = np.sqrt((mono[: len(mono) // w * w].reshape(-1, w) ** 2).mean(1))
    rdb = 20 * np.log10(r + 1e-9)
    return {"centroid_hz": round(float(np.median(cen)), 1), "flux_low": round(fl(lowE), 3), "flux_mid": round(fl(midE), 3),
            "rms50_std_db": round(float(rdb.std()), 2)}


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
         "rms15_curve": curve}
    r.update(metrics(x))
    ok = (abs(info["secs"] - DUR) <= 0.5 and info["size"] <= 8 * 1024 * 1024 and tot_pk <= CEIL_DB + 0.01
          and abs(tot_lu - TARGET_LUFS) <= 0.5 and info["brs"] == {BITRATE * 1000} and jump <= max(3 * typ, 0.02))
    r["ok"] = bool(ok)
    return ok, r


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=f"'{TITLE}' BGM 합성")
    ap.add_argument("--out", default=f"bgm-{TRACK_ID}.mp3", help="MP3 출력 경로(같은 폴더에 json·report.json)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV(선택)")
    args = ap.parse_args(argv)
    t0 = time.time()
    print(f"합성 시작: {TRACK_ID} {BPM} BPM, {BARS}마디, {DUR:.3f}초, seed {SEED}")
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
    base = os.path.splitext(out)[0]
    meta = {"title": TITLE, "mood": MOOD, "stage": STAGE, "energy": ENERGY, "duration": int(round(DUR)),
            "bpm": BPM, "key": KEY_NAME,
            "sections": [{"name": s["n"], "part": s["part"], "start": round(tb(s["start"]), 3)} for s in SECS],
            "seed": SEED}
    with open(base + ".json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs, brs = mp3_frames(mp3)
    info = dict(frames=frames, secs=secs, brs=brs, size=len(mp3), sha=hashlib.sha256(mp3).hexdigest())
    ok, rep = check(mix, info)
    rep["limiter_gr_db"] = round(gr, 2)
    rep["wall_s"] = round(time.time() - t0, 1)
    with open(os.path.join(outdir, f"report-{TRACK_ID}.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "rms15_curve"}, ensure_ascii=False))
    print("  15초 창 RMS:", rep["rms15_curve"])
    print("검사:", "통과" if ok else "실패")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
