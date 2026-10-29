#!/usr/bin/env python3
"""'펄서 시퀀스' 스페이스 앰비언트·베를린 스쿨 BGM 결정적 합성기 (활동 단계 2 · 활발, Planet 표현).

16분 베를린 스쿨 시퀀서(톱니, 마디·32마디 LFO로 천천히 열리고 닫히는 필터 엔벨로프, 3박 단위 악센트),
부드러운 4분 킥과 오프비트 햇·셰이커, 서브 베이스, 넓은 디튠 패드, 고조에서 벨 선율. A 마이너(에올리안).
112 BPM 4/4 140마디 = 정확히 300초. 처음과 끝은 같은 패드 + 옅은 시퀀서(루프).
  인트로(0～12) → 전개(12～32) 서브·셰이커 → 그루브(32～60) 킥·햇 → 고조(60～88) 벨 선율·필터 최대
  → 브레이크(88～100) 킥 빠짐 → 흐름(100～128) → 아웃트로(128～140) 처음 상태로

사용법:
  python compose_pulsar.py --out bgm-pulsar.mp3 [--wav 미리듣기.wav]
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

TRACK_ID = "pulsar"
SEED = 2026
BPM = 112
TITLE = "펄서 시퀀스"
MOOD = "스페이스 앰비언트 · 베를린 스쿨 16분 시퀀서, 부드러운 킥·서브 펄스, 넓은 패드와 벨"
KEY_NAME = "A minor"
STAGE = 2
ENERGY = 0.6
REVERB = (5.5, 4.6, 2.0)
WET = 0.55
ECHO_BEATS = 0.75
MASTER_LP = 9000
_P = {"pad": 1.0}
SECS = [
    {"n": "인트로", "part": "기", "bars": 12, **_P, "seq": 0.55, "filt": 0.15},
    {"n": "전개", "part": "승", "bars": 20, **_P, "seq": 0.85, "sub": 1.0, "shaker": 0.7, "filt": 0.35},
    {"n": "그루브", "part": "승", "bars": 28, **_P, "seq": 1.0, "sub": 1.0, "shaker": 1.0, "kick": 1.0, "hat": 1.0, "filt": 0.55},
    {"n": "고조", "part": "전", "bars": 28, **_P, "seq": 1.0, "sub": 1.0, "shaker": 1.0, "kick": 1.0, "hat": 1.0, "mel": 1.0, "filt": 0.9},
    {"n": "브레이크", "part": "전", "bars": 12, **_P, "seq": 0.7, "sub": 0.5, "mel": 0.8, "filt": 0.45},
    {"n": "흐름", "part": "결", "bars": 28, **_P, "seq": 1.0, "sub": 1.0, "shaker": 1.0, "kick": 1.0, "hat": 1.0, "mel": 0.5, "filt": 0.7},
    {"n": "아웃트로", "part": "결", "bars": 12, **_P, "seq": 0.55, "filt": 0.15},
]
# 4마디씩: Am9 – Fmaj7#11 – Dm9 – Em11 (시퀀서 근음, (3도, 7도), 패드 음)
PROG = [(45, (3, 10), [57, 60, 64, 67, 71]), (41, (4, 11), [53, 57, 60, 64, 71]),
        (38, (3, 10), [53, 57, 60, 62, 64]), (40, (3, 10), [55, 59, 62, 64, 69])]
PAT = [0, 12, 7, 12, "3", 12, 7, "7", 0, 12, 7, 12, "3", "15", "7", 7]
MOTIF = [(0, 76, 2), (2, 79, 2), (4, 81, 4), (8, 84, 2), (10, 83, 2), (12, 79, 4),
         (16, 76, 2), (18, 74, 2), (20, 72, 4), (24, 74, 3), (27, 72, 1), (28, 69, 4)]


def chord(bar):
    return PROG[(bar // 4) % len(PROG)]


def build():
    pad = Layer("pad", dry=0.65, rev=0.5, hp=110, sweep=(500, 2600), width=1.25, duck=0.3, tau=3.0)
    seq = Layer("seq", dry=0.7, rev=0.25, echo=0.18, lp=4200, hp=70, duck=0.25, tau=1.5)
    sub = Layer("sub", dry=1.0, rev=0.0, lp=200, duck=0.45, tau=1.5)
    kk = Layer("kick", dry=1.0, rev=0.04, lp=2500, tau=0.3)
    hat = Layer("hat", dry=0.7, rev=0.2, lp=8500, hp=3000, tau=0.5)
    shk = Layer("shaker", dry=0.6, rev=0.25, lp=8000, hp=2500, width=1.0, tau=1.0)
    mel = Layer("mel", dry=0.4, rev=0.6, echo=0.4, lp=4500, hp=300, tau=3.0)
    for bar in range(0, BARS, 4):
        root, (t3, t7), notes = chord(bar)
        for m in notes:
            pad.add(tb(bar), pad_note(m, 4 * BAR + 0.2, a=1.5, rel=2.2, cents=13.0), 0.2)
        if lv("sub", bar) > 0:
            for k in range(4):
                sub.add(tb(bar + k), sub_note(root - 12, BAR - 0.08, a=0.01, rel=0.1, h2=0.18), 0.22)
    ph = 2 * math.pi / 32
    for bar in range(BARS):
        root, (t3, t7), notes = chord(bar)
        oct_f = lv("filt", bar) * 2.2 + 0.35 * math.sin(ph * bar)
        fc0 = int(600 * 2 ** (round(oct_f * 4) / 4))
        for i, p in enumerate(PAT):
            off = {"3": t3, "15": t3 + 12, "7": t7}.get(p, p) if isinstance(p, str) else p
            v = 0.68 if i % 3 == 0 else 0.44
            seq.add(tb(bar, i * 0.25), saw_note(root + off, BEAT * 0.2, fc0 * (1.25 if i % 3 == 0 else 1.0), 200, tau=0.055,
                                                a=0.002, rel=0.04), v, pan=0.18 if i % 2 else -0.18)
        if lv("kick", bar) > 0:
            for bt in range(4):
                KICKS.append(tb(bar, bt))
                kk.add(tb(bar, bt), kick(46.0, 70.0, 0.03, 0.26, click=0.12), 0.48)
        if lv("hat", bar) > 0:
            for bt in range(4):
                hat.add(tb(bar, bt + 0.5), noise_hit(bt % 4, tau=0.035, fc=7000, q=0.7, lp=9000), 1.0, pan=0.25)
        if lv("shaker", bar) > 0:
            for i in range(16):
                shk.add(tb(bar, i * 0.25), noise_hit(4 + i % 4, tau=0.018, fc=5200, q=0.9, lp=8500),
                        0.6 if i % 4 == 2 else 0.35, pan=-0.3)
        if lv("mel", bar) > 0 and bar % 8 == 0:
            for (b, m, d) in MOTIF:
                mel.add(tb(bar, b), bell(m, 1.0 + d * 0.4, index=1.1), 1.0, pan=0.3 if (b // 4) % 2 else -0.3)
    return [pad, seq, sub, kk, hat, shk, mel]

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
