#!/usr/bin/env python3
"""아침 카페 보사노바 — 복셀 오피스 한가(0단계) 배경음악.

나일론 기트 보사노바 컴핑, 펠트 피아노 주제, B 구간 플루트, 업라이트 베이스, 셰이커·크로스스틱·소프트 서도.
116 BPM, 4/4, 145마디 = 정확히 300초, D major, 시드 2026 결정적 합성. 외부 샘플 없음.
원형 버퍼 합성이라 끝과 처음이 같은 나일론 기타 Dmaj9 로 이어진다(루프).

  python compose_bossa.py --out <폴더>/bgm-bossa.mp3
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

ID = "bossa"
SEED = 2026
BPM = 116
BARS = 145
KEY = "D major"
TITLE = "아침 카페 보사노바"
MOOD = "한가 · 아침 카페 보사노바 — 나일론 기타 컴핑, 펠트 피아노 주제, 플루트, 업라이트 베이스, 셰이커·크로스스틱"
SECTIONS = [("인트로", 0), ("A", 16), ("B", 48), ("A · 다시", 80), ("아웃트로", 112)]

PROG_A = ["Dmaj9", "Dmaj9", "Bm9", "Bm9", "Em9", "Em9", "A13", "A7b9",
          "F#m7", "F#m7", "B7b9", "B7b9", "Em9", "Em9", "A7sus", "A13"]
PROG_B = ["Gmaj9", "Gmaj9", "Gm6", "Gm6", "F#m7", "F#m7", "Bm9", "Bm9",
          "Em9", "Em9", "A13", "A13", "Dmaj9", "Dmaj9", "A7sus", "A13"]


def chord_name(bar):
    bar %= BARS
    return PROG_B[(bar - 48) % 16] if 48 <= bar < 80 else PROG_A[bar % 16]


def chord_scale(bar):
    sc = set(scale_of(2, "major"))
    cp = chord_pcs(chord(chord_name(bar)))
    for p in cp:
        if p not in sc:
            for q in ((p + 1) % 12, (p - 1) % 12):
                if q in sc and q not in cp:
                    sc.discard(q)
            sc.add(p)
    return sorted(sc)


T1 = [(0, 3), (3, 1), (4, 4), (10, 2), (12, 4), (16, 3), (19, 1), (20, 6), (28, 4)]
T2 = [(1, 2), (3, 3), (6, 2), (8, 6), (16, 2), (18, 2), (20, 2), (22, 6), (30, 2)]
T3 = [(0, 2), (2, 2), (4, 2), (6, 6), (14, 2), (16, 4), (20, 4), (24, 8)]


def phrase(seed, bar0, tmpl, start, lo, hi):
    r = np.random.default_rng(seed)
    m, out = start, []
    for slot, ln in tmpl:
        bar = bar0 + slot // 8
        pcs = chord_pcs(chord(chord_name(bar)))
        if slot % 4 == 0 or ln >= 4:
            m = nearest_pc(m + int(r.choice([-4, -2, -1, 1, 2, 3, 5])), pcs)
        else:
            m = step_in(m, int(r.choice([-1, 1, -2, 2])), chord_scale(bar))
        while m > hi:
            m = nearest_pc(m - 7, pcs)
        while m < lo:
            m = nearest_pc(m + 7, pcs)
        out.append((tb(bar, (slot % 8) * 0.5), ln * 0.5 * BEAT, m))
    return out


def melody(sc, bus, inst, bar0, bars, seeds, tmpls, vel, pan, lo=66, hi=81):
    for k in range(bars // 4):
        b = bar0 + 4 * k
        for t, d, m in phrase(seeds[k % len(seeds)], b, tmpls[k % len(tmpls)], 74, lo, hi):
            v = vel * (0.9 + 0.2 * rng.random())
            sc.note(bus, t, inst, m, d * 0.95, v, pan, jit=0.01)


def compose():
    sc = Score()
    prev = None
    for bar in range(BARS):
        ch = chord(chord_name(bar))
        vo = voicing(ch, 52, 67, prev, rootless=True)
        prev = vo
        slots = [0, 3, 5] if bar % 2 == 0 else [1, 3, 6]
        g = 0.36 if 16 <= bar < 112 else 0.42
        for s in slots:
            t = tb(bar, s * 0.5)
            for i, m in enumerate(vo):
                sc.note("guitar", t + 0.009 * i, "nylon", m, BEAT * 0.9, g * (0.85 + 0.25 * rng.random()), -0.25)
        # 엄지 베이스(근음·5도, 점4분 느낌)
        root = ch[2]
        lo = 40 + (root - 40) % 12
        fifth = lo + 7 if lo + 7 <= 52 else lo - 5
        tv = 0.32 if 16 <= bar < 112 else 0.42
        sc.note("guitar", tb(bar, 0), "nylon", lo, BEAT * 1.4, tv, -0.2)
        sc.note("guitar", tb(bar, 2), "nylon", fifth, BEAT * 1.4, tv * 0.9, -0.2)
        # 업라이트 베이스(A·B·A')
        if 16 <= bar < 112:
            blo = 28 + (root - 28) % 12
            bf = blo + 7
            sc.note("bass", tb(bar, 0), "upright", blo, BEAT * 1.4, 0.75, 0)
            sc.note("bass", tb(bar, 1.5), "upright", blo, BEAT * 0.45, 0.35, 0)
            sc.note("bass", tb(bar, 2), "upright", bf, BEAT * 1.4, 0.65, 0)
            nr = chord(chord_name(bar + 1))[2]
            nlo = 28 + (nr - 28) % 12
            sc.note("bass", tb(bar, 3.5), "upright", nlo + (1 if rng.random() < 0.5 else -1), BEAT * 0.45, 0.4, 0)
        # 타악
        if 8 <= bar < 136:
            sv = 0.16 if (bar < 16 or bar >= 112) else 0.22
            for s in range(16):
                acc = 1.0 if s % 4 == 2 else 0.6 if s % 2 == 0 else 0.45
                sc.hit("perc", tb(bar, s * 0.25), "shaker", sv * acc, 0.35)
        if 16 <= bar < 112:
            cl = [0, 3, 6] if bar % 2 == 0 else [2, 4]
            for s in cl:
                sc.hit("perc", tb(bar, s * 0.5), "rim", 0.22, -0.3)
            for bt, v in ((0, 0.42), (1.5, 0.18), (2, 0.36)):
                sc.hit("kick", tb(bar, bt), "kick", v, 0)
    # 주제(펠트 피아노) — A 16마디 주제를 두 번
    sa = [11, 12, 13, 14]
    melody(sc, "piano", "felt", 16, 32, sa, [T1, T2, T1, T3], 0.5, 0.2)
    melody(sc, "piano", "felt", 80, 32, sa, [T1, T2, T1, T3], 0.5, 0.2)
    # B: 플루트 주제 + 피아노 긴 화음
    melody(sc, "flute", "flute", 48, 32, [21, 22, 23, 24], [T3, T1, T2, T1], 0.42, 0.15, lo=69, hi=84)
    pv = None
    for bar in range(48, 80, 2):
        vo = voicing(chord(chord_name(bar)), 57, 72, pv, rootless=True)
        pv = vo
        for i, m in enumerate(vo):
            sc.note("piano", tb(bar) + 0.02 * i, "felt", m, BAR * 1.9, 0.18, 0.2)
    # 아웃트로: 주제 앞 두 프레이즈를 여리게 회상
    melody(sc, "piano", "felt", 112, 8, sa[:2], [T1, T2], 0.34, 0.2)
    return sc


def arrange(buses):
    spec = {
        "guitar": (1.0, 6000, 70, 0.30, None),
        "bass": (0.6, 1200, 35, 0.05, None),
        "piano": (1.1, 5000, 90, 0.40, None),
        "flute": (1.4, 6000, 200, 0.45, None),
        "kick": (0.45, 2000, 30, 0.05, None),
        "perc": (2.2, 8000, 200, 0.25, None),
    }
    master = [(0, 0.86), (8, 0.88), (16, 1.0), (112, 1.0), (128, 0.9), (145, 0.86)]
    return mixdown(buses, spec, master, rev_gain=0.30, rev=(2.4, 1.7, 0.6))

# ───────────────────────── 공통 엔진(복셀 오피스 곡 공용, compose.py·compose_jazz.py 유틸 이식) ─────────────────────────

SR = 44100
BEAT = 60.0 / BPM
BAR = 4 * BEAT
DUR = BARS * BAR             # 정확히 300초
N = int(round(DUR * SR))
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
F32 = np.float32
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
    """원형 버퍼에 더하기 — 끝을 넘는 꼬리는 앞머리로 감긴다(루프 이음매)."""
    if sig.ndim == 1:
        gl, gr = pan_gains(pan)
        sig = np.stack([sig * gl, sig * gr])
    n = sig.shape[1]
    i0 = int(round(t0 * SR)) % N
    end = i0 + n
    if end <= N:
        buf[:, i0:end] += sig
    else:
        k = N - i0
        buf[:, i0:] += sig[:, :k]
        rest = sig[:, k:]
        buf[:, : rest.shape[1]] += rest


def automation(points):
    xs = np.array([p[0] * BAR for p in points])
    ys = np.array([p[1] for p in points])
    t = np.arange(N, dtype=np.float64) / SR
    return np.interp(t, xs, ys).astype(F32)


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


def shelf_mag(f, fc, gain_db):
    rr = (f / fc) ** 4
    return 1 + (10 ** (gain_db / 20) - 1) * rr / (1 + rr)


def fd_filter(x, mag):
    X = np.fft.rfft(x, axis=-1)
    X *= mag.astype(X.real.dtype)
    return np.fft.irfft(X, n=x.shape[-1], axis=-1).astype(F32)


def circ_conv(x, ir):
    out = np.zeros((2, N), dtype=F32)
    for ch in range(2):
        h = np.zeros(N, dtype=F32)
        h[: ir.shape[1]] = ir[ch]
        out[ch] = np.fft.irfft(np.fft.rfft(x[ch]) * np.fft.rfft(h), n=N).astype(F32)
    return out


def reverb_ir(length=2.6, rt60_lo=1.8, rt60_hi=0.7):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.015 * SR)
    for ch in range(2):
        noise = rng.standard_normal(n)
        spec = np.fft.rfft(noise)
        fr = np.fft.rfftfreq(n, 1 / SR)
        lo = np.fft.irfft(spec * lp_mag(fr, 1800, 1), n=n)
        hi = np.fft.irfft(spec * hp_mag(fr, 1800, 1), n=n)
        tail = lo * np.exp(-6.91 * t / rt60_lo) + hi * np.exp(-6.91 * t / rt60_hi)
        tail *= 1 - np.exp(-t / 0.03)
        ir[ch, pre:] = tail[: n - pre]
        for k, ms in enumerate((9, 15, 23, 31, 43, 59, 73)):
            idx = int((ms + (3 if ch else 0)) * SR / 1000)
            ir[ch, idx] += 0.5 * (0.8 ** k) * (1 if (k + ch) % 2 else -1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


# ───────────────────────── 화음·음계 ─────────────────────────

PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"maj7": [0, 4, 7, 11], "maj9": [0, 4, 7, 11, 14], "6": [0, 4, 7, 9], "69": [0, 4, 7, 9, 14],
        "m7": [0, 3, 7, 10], "m9": [0, 3, 7, 10, 14], "m6": [0, 3, 7, 9], "7": [0, 4, 7, 10],
        "9": [0, 4, 7, 10, 14], "13": [0, 4, 7, 10, 14, 21], "7b9": [0, 4, 7, 10, 13], "m7b5": [0, 3, 6, 10],
        "dim7": [0, 3, 6, 9], "7sus": [0, 5, 7, 10], "": [0, 4, 7], "m": [0, 3, 7]}


def chord(name):
    """'Dmaj9' → (근음 pc, 음정 목록). 슬래시 베이스 'F/C' 는 (근음, 음정, 베이스 pc)."""
    bass = None
    if "/" in name:
        name, b = name.split("/")
        bass = (PC[b[0]] + (1 if b[1:2] == "#" else -1 if b[1:2] == "b" else 0)) % 12
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


def nearest_pc(m, pcs):
    best = None
    for d in range(0, 12):
        for s in (m - d, m + d):
            if s % 12 in pcs:
                return s
    return m if best is None else best


def step_in(m, n, pcs):
    """음계 pcs 안에서 n 걸음 이동."""
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
        # 5음 넘으면 5도부터 뺀다
        ivs = [i for i in ivs if i != 7][:maxn] if 7 in ivs else ivs[:maxn]
    center = (lo + hi) / 2 if prev is None else sum(prev) / len(prev)
    out = []
    for i in ivs:
        pc = (r + i) % 12
        cands = [m for m in range(lo, hi + 1) if m % 12 == pc]
        if not cands:
            continue
        out.append(min(cands, key=lambda m: abs(m - center)))
    out = sorted(set(out))
    return out


def scale_of(key_pc, mode="major"):
    s = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10], "dorian": [0, 2, 3, 5, 7, 9, 10],
         "mixo": [0, 2, 4, 5, 7, 9, 10], "blues": [0, 3, 5, 6, 7, 10]}[mode]
    return sorted((key_pc + i) % 12 for i in s)


# ───────────────────────── 악기(모노 float32) ─────────────────────────

def _gate(t, dur, rel):
    g = np.ones_like(t)
    m = t > dur
    g[m] = np.exp(-(t[m] - dur) / max(rel / 5.0, 1e-4))
    return g


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


def nylon(f, dur, v):
    K = np.arange(1, 13)
    amps = np.abs(np.sin(np.pi * K * 0.17)) / K ** 1.1 * (0.55 + 0.45 * v) ** (K - 1)
    sc = (196.0 / f) ** 0.35
    taus = 2.4 * sc / (1 + 0.5 * (K - 1))
    return additive(f, dur, v, K * np.sqrt(1 + 0.00004 * K * K), amps, taus, att=0.0015, rel=0.12)


def eguitar(f, dur, v):
    K = np.arange(1, 11)
    amps = np.abs(np.sin(np.pi * K * 0.12)) / K ** 0.9
    taus = 0.9 / (1 + 0.4 * (K - 1))
    return additive(f, dur, v, K, amps, taus, att=0.001, rel=0.03, hmax=5000)


def felt(f, dur, v):
    K = np.arange(1, 9)
    amps = 1.0 / K ** 1.9 * (0.5 + 0.5 * v) ** (K - 1)
    sc = (440.0 / f) ** 0.3
    taus = 3.2 * sc / (1 + 0.6 * (K - 1))
    return additive(f, dur, v, K * np.sqrt(1 + 0.0002 * K * K), amps, taus, att=0.006, rel=0.3, hmax=5000)


def epiano(f, dur, v):
    n = int((dur + 0.25) * SR) + 1
    t = np.arange(n) / SR
    idx = (0.6 + 1.1 * v) * np.exp(-t / 0.22) + 0.12
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    y += 0.12 * np.exp(-t / 0.08) * np.sin(2 * np.pi * f * 7.0 * t) * (f * 7 < 6000)
    y *= np.exp(-t / (2.0 * (262.0 / f) ** 0.4)) * (1 - np.exp(-t / 0.002)) * _gate(t, dur, 0.25) * v
    return y.astype(F32)


def upright(f, dur, v):
    amps = [1, 0.5, 0.22, 0.12, 0.06, 0.03]
    taus = [1.3, 0.8, 0.5, 0.35, 0.25, 0.2]
    return additive(f, dur, v, [1, 2, 3, 4, 5, 6], amps, taus, att=0.007, rel=0.06)


def pizz(f, dur, v):
    K = np.arange(1, 9)
    return additive(f, dur, v, K, 1.0 / K ** 1.4, 0.4 / (1 + 0.35 * (K - 1)), att=0.003, rel=0.08, hmax=5000)


def brass(f, dur, v, bright=0.6):
    K = np.arange(1, 16)
    p = 1.0 + 1.3 * (1 - bright * (0.6 + 0.4 * v))
    amps = 1.0 / K ** p
    taus = np.full(len(K), 2.5)
    return additive(f, dur, v, K, amps, taus, att=0.014, rel=0.09, vib=0.0035, vib_rate=5.6,
                    vib_delay=0.35, hmax=4800, att_spread=0.22)


def tuba(f, dur, v):
    K = np.arange(1, 9)
    return additive(f, dur, v, K, 1.0 / K ** 1.8, np.full(8, 1.6), att=0.02, rel=0.08, hmax=1800, att_spread=0.2)


def sax(f, dur, v):
    K = np.arange(1, 14)
    amps = 1.0 / K ** 1.25 * (1 + 0.8 * np.exp(-((f * K - 1300) / 700.0) ** 2))
    return additive(f, dur, v, K, amps, np.full(13, 3.0), att=0.022, rel=0.08, vib=0.005, vib_rate=5.2,
                    vib_delay=0.3, hmax=4500, att_spread=0.1)


def clarinet(f, dur, v):
    K = np.arange(1, 12)
    amps = np.where(K % 2 == 1, 1.0 / K, 0.25 / K ** 2)
    return additive(f, dur, v, K, amps, np.full(11, 3.0), att=0.015, rel=0.06, vib=0.003, vib_rate=5.0,
                    vib_delay=0.4, hmax=4500)


def flute(f, dur, v):
    return additive(f, dur, v, [1, 2, 3], [1, 0.22, 0.07], [0, 0, 0], att=0.045, rel=0.12, vib=0.006,
                    vib_rate=4.8, vib_delay=0.3, hmax=6000)


def xylo(f, dur, v):
    return additive(f, 0.02, v, [1, 3.93, 9.2], [1, 0.22, 0.05], [0.32, 0.07, 0.025], att=0.0008,
                    rel=0.02, tail=0.6, hmax=7000)


def vibes(f, dur, v):
    return additive(f, dur, v, [1, 4.0, 10.0], [1, 0.12, 0.03], [1.6, 0.35, 0.1], att=0.002, rel=0.3,
                    vib=0.0, hmax=7000)


def organ(f, dur, v):
    n = int((dur + 0.04) * SR) + 1
    t = np.arange(n) / SR
    y = np.zeros(n)
    for r, a in ((0.5, 0.45), (1, 1.0), (2, 0.55), (3, 0.25), (4, 0.18)):
        if f * r < 5000:
            y += a * np.sin(2 * np.pi * f * r * t + r)
    y *= (1 - np.exp(-t / 0.003)) * _gate(t, dur, 0.04) * v
    y[: int(0.004 * SR)] += 0.08 * v * np.sin(2 * np.pi * 2400 * t[: int(0.004 * SR)])
    return y.astype(F32)


# 드럼: 변형 몇 개를 미리 만들어 두고 고른다
def _noise(n, lo, hi):
    x = rng.standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    return np.fft.irfft(np.fft.rfft(x) * hp_mag(fr, lo, 2) * lp_mag(fr, hi, 2), n=n)


def _mk_drum(kind, var):
    if kind == "kick":
        n = int(0.5 * SR)
        t = np.arange(n) / SR
        fr = 48 + 70 * np.exp(-t / 0.035)
        y = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.22)
        y += 0.25 * _noise(n, 200, 2500) * np.exp(-t / 0.006)
    elif kind == "snare":
        n = int(0.35 * SR)
        t = np.arange(n) / SR
        y = 0.6 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) + 1.1 * _noise(n, 300, 6000) * np.exp(-t / 0.10)
    elif kind == "ghost":
        n = int(0.2 * SR)
        t = np.arange(n) / SR
        y = 0.3 * np.sin(2 * np.pi * 200 * t) * np.exp(-t / 0.03) + 0.8 * _noise(n, 400, 5000) * np.exp(-t / 0.05)
    elif kind == "brush":
        n = int(0.45 * SR)
        t = np.arange(n) / SR
        y = _noise(n, 500, 4500) * (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.11)
    elif kind == "hat":
        n = int(0.12 * SR)
        t = np.arange(n) / SR
        y = _noise(n, 6000, 10000) * np.exp(-t / 0.025)
    elif kind == "hatpedal":
        n = int(0.1 * SR)
        t = np.arange(n) / SR
        y = _noise(n, 3000, 8000) * np.exp(-t / 0.02)
    elif kind == "ride":
        n = int(1.2 * SR)
        t = np.arange(n) / SR
        y = 0.6 * _noise(n, 3000, 8000) * np.exp(-t / 0.28)
        for fr_, a in ((2913, 0.25), (3720, 0.2), (5170, 0.12), (6230, 0.07)):
            y += a * np.sin(2 * np.pi * fr_ * t) * np.exp(-t / 0.6)
        y *= 1 - 0.6 * np.exp(-t / 0.004) + 0.6 * np.exp(-t / 0.004) * 1.8
    elif kind == "crash":
        n = int(2.5 * SR)
        t = np.arange(n) / SR
        y = _noise(n, 1500, 7000) * np.exp(-t / 0.9) * (1 - np.exp(-t / 0.01))
    elif kind == "rim":
        n = int(0.12 * SR)
        t = np.arange(n) / SR
        y = (np.sin(2 * np.pi * 820 * t) + 0.5 * np.sin(2 * np.pi * 1650 * t)) * np.exp(-t / 0.018)
        y += 0.4 * _noise(n, 1000, 6000) * np.exp(-t / 0.006)
    elif kind == "shaker":
        n = int(0.12 * SR)
        t = np.arange(n) / SR
        y = _noise(n, 3500, 9000) * (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.04)
    elif kind in ("wood", "woodlo"):
        n = int(0.15 * SR)
        t = np.arange(n) / SR
        f0 = 1150 if kind == "wood" else 820
        y = (np.sin(2 * np.pi * f0 * t) + 0.3 * np.sin(2 * np.pi * f0 * 2.7 * t)) * np.exp(-t / 0.035)
    elif kind == "tom":
        n = int(0.5 * SR)
        t = np.arange(n) / SR
        f0 = 140 - 20 * var
        y = np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.3 * np.exp(-t / 0.04))) / SR) * np.exp(-t / 0.2)
    else:
        raise ValueError(kind)
    y = y / max(np.abs(y).max(), 1e-9)
    return y.astype(F32)


_DRUMS = {}


def drum(kind, v):
    vars_ = _DRUMS.get(kind)
    if vars_ is None:
        vars_ = _DRUMS[kind] = [_mk_drum(kind, i) for i in range(4)]
    return vars_[int(rng.integers(4))] * F32(v)


INSTR = {"nylon": nylon, "eguitar": eguitar, "felt": felt, "epiano": epiano, "upright": upright, "pizz": pizz,
         "brass": brass, "brassd": lambda f, d, v: brass(f, d, v, 0.35), "tuba": tuba, "sax": sax,
         "clarinet": clarinet, "flute": flute, "xylo": xylo, "vibes": vibes, "organ": organ}


# ───────────────────────── 악보 → 버스 ─────────────────────────

class Score:
    def __init__(self):
        self.ev = []

    def note(self, bus, t, inst, m, dur, v, pan=0.0, jit=0.006):
        self.ev.append((bus, t + float(rng.normal(0, jit)), inst, m, dur, v, pan))

    def hit(self, bus, t, kind, v, pan=0.0, jit=0.004):
        self.ev.append((bus, t + float(rng.normal(0, jit)), "drum:" + kind, 0, 0, v, pan))


def render_score(sc, log=print):
    buses = {}
    cache = {}
    for bus, t, inst, m, dur, v, pan in sc.ev:
        b = buses.get(bus)
        if b is None:
            b = buses[bus] = new_bus()
        if inst.startswith("drum:"):
            sig = drum(inst[5:], v)
        else:
            vq = round(v * 40) / 40
            key = (inst, round(m, 2), round(dur, 3), vq)
            sig = cache.get(key)
            if sig is None:
                sig = INSTR[inst](mtof(m), dur, vq)
                if len(cache) < 6000:
                    cache[key] = sig
            sig = sig * F32(v / max(vq, 1e-3))
        add(b, max(t, 0.0) if t > -0.05 else t % DUR, sig, pan)
    log(f"  악보 {len(sc.ev)}개 사건, 버스 {sorted(buses)}")
    return buses


# ───────────────────────── 라우드니스·리미터 ─────────────────────────

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
    pad = nb * w - m
    xp = np.concatenate([xp, np.full(pad, np.inf)])
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
    g = moving_avg(sliding_min(need, 2 * w + 1), w)
    g = np.minimum(g, 1.0)
    return (x * g[None, :]).astype(F32), float(20 * np.log10(g.min()))


def mixdown(buses, spec, master_pts, rev_gain=0.28, rev=(2.6, 1.8, 0.7), log=print):
    """spec: 버스 → (게인, 로우패스 Hz, 하이패스 Hz, 리버브 보내기, 자동화 점)."""
    f = freqs()
    mix, send = new_bus(), new_bus()
    for name, (g, lp, hp, rs, pts) in spec.items():
        x = buses.pop(name, None)
        if x is None:
            continue
        mag = np.ones_like(f)
        if lp:
            mag = mag * lp_mag(f, lp, 2)
        if hp:
            mag = mag * hp_mag(f, hp, 2)
        x = fd_filter(x, mag)
        if pts:
            x *= automation(pts)[None, :]
        x *= F32(g)
        mix += x
        send += F32(rs) * x
        log(f"    버스 {name:8s} RMS {db(math.sqrt(float((x.astype(np.float64) ** 2).mean()))):6.1f} dB")
        del x
    wet = circ_conv(send, reverb_ir(*rev))
    wet = fd_filter(wet, hp_mag(f, 180, 1) * lp_mag(f, 6500, 1))
    mix += F32(rev_gain) * wet
    del wet, send
    mix *= automation(master_pts)[None, :]
    # 고음 날카로움 억제: 6kHz 위 −5dB 셸프 + 12kHz 로우패스
    mix = fd_filter(mix, hp_mag(f, 28, 2) * lp_mag(f, 12000, 1) * shelf_mag(f, 6000, -5))
    l0 = loudness(mix)
    mix *= F32(10 ** ((TARGET_LUFS - l0) / 20))
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
    for _ in range(3):
        l1 = loudness(mix)
        if abs(l1 - TARGET_LUFS) < 0.2:
            break
        mix *= F32(10 ** ((TARGET_LUFS - l1) / 20))
        mix, g2 = limiter(mix, ceil)
        gr = min(gr, g2)
    pk = float(np.abs(mix).max())
    if pk > ceil:
        mix *= F32(ceil / pk)
    return mix, gr


# ───────────────────────── 인코딩·분석 ─────────────────────────

def db(v):
    return 20 * math.log10(max(v, 1e-12))


def to_int16(x):
    d = (rng.random(x.shape) - rng.random(x.shape))
    y = np.round(x.astype(np.float64) * 32767.0 + d)
    return np.clip(y, -32768, 32767).astype(np.int16)


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
        brs.add(br)
        frames += 1
        i += 144 * br // sr + ((h[2] >> 1) & 1)
    return frames, frames * 1152 / sr, sorted(brs)


def analyze(x, log=print):
    res = {}
    bounds = [b for _, b in SECTIONS] + [BARS]
    mono = x.astype(np.float64).mean(axis=0)
    nfft, hop = 4096, 4410
    win = np.hanning(nfft)
    idx0 = np.arange(0, len(mono) - nfft, hop)
    cen = np.empty(len(idx0))
    pw = np.empty(len(idx0))
    hi_e = 0.0
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    for j0 in range(0, len(idx0), 400):
        idx = idx0[j0:j0 + 400][:, None] + np.arange(nfft)[None, :]
        P = np.abs(np.fft.rfft(mono[idx] * win, axis=1)) ** 2
        cen[j0:j0 + 400] = (P * fr).sum(1) / np.maximum(P.sum(1), 1e-20)
        pw[j0:j0 + 400] = P.sum(1)
        hi_e += P[:, fr >= 8000].sum()
    tt = (idx0 + nfft / 2) / SR
    rows = []
    for k, (name, b0) in enumerate(SECTIONS):
        i0, i1 = int(tb(b0) * SR), int(tb(bounds[k + 1]) * SR)
        seg = x[:, i0:i1].astype(np.float64)
        m = (tt >= tb(b0)) & (tt < tb(bounds[k + 1]))
        rows.append({"name": name, "bars": [b0, bounds[k + 1]], "rms_db": round(db(math.sqrt(float((seg ** 2).mean()))), 2),
                     "lufs": round(loudness(seg), 2), "centroid_hz": round(float((cen[m] * pw[m]).sum() / pw[m].sum()), 0)})
    res["sections"] = rows
    xx = x.astype(np.float64)
    res["rms_db"] = round(db(math.sqrt(float((xx ** 2).mean()))), 2)
    res["peak_db"] = round(db(float(np.abs(xx).max())), 2)
    res["lufs"] = round(loudness(x), 2)
    res["centroid_hz"] = round(float((cen * pw).sum() / pw.sum()), 0)
    res["hf8k_ratio_db"] = round(10 * math.log10(hi_e / max(pw.sum(), 1e-20)), 1)
    # 16분음표 자리 에너지 요동(바쁨 지표): 1/16박 창 RMS 의 변동계수
    w = int(BEAT / 4 * SR)
    e = np.sqrt((mono[: len(mono) // w * w].reshape(-1, w) ** 2).mean(1))
    res["busy_cv"] = round(float(e.std() / max(e.mean(), 1e-12)), 3)
    a = xx[:, -int(0.05 * SR):]
    b = xx[:, :int(0.05 * SR)]
    res["seam"] = {"end50ms_rms_db": round(db(math.sqrt((a ** 2).mean())), 2),
                   "start50ms_rms_db": round(db(math.sqrt((b ** 2).mean())), 2),
                   "jump": round(float(np.abs(xx[:, 0] - xx[:, -1]).max()), 5),
                   "typ_max_step": round(float(np.abs(np.diff(xx[:, :SR], axis=1)).max()), 5),
                   "end1s_lufs": round(loudness(x[:, -SR:]), 2), "start1s_lufs": round(loudness(x[:, :SR]), 2)}
    log("  구간: " + " | ".join(f"{r['name']} {r['lufs']}LUFS {r['centroid_hz']:.0f}Hz" for r in rows))
    log(f"  전체 {res['lufs']} LUFS, 피크 {res['peak_db']} dBFS, RMS {res['rms_db']}, 중심 {res['centroid_hz']:.0f}Hz, "
        f"8k↑ {res['hf8k_ratio_db']} dB, 바쁨 {res['busy_cv']}")
    log(f"  이음매 {res['seam']}")
    return res


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=f"{TITLE} 합성")
    ap.add_argument("--out", default=f"bgm-{ID}.mp3")
    ap.add_argument("--wav", default=None)
    ap.add_argument("--no-report", action="store_true")
    args = ap.parse_args(argv)
    t0 = time.time()
    print(f"합성 시작: {ID} {BPM} BPM, {BARS}마디, {DUR:.1f}초, seed {SEED}")
    sc = compose()
    buses = render_score(sc)
    print(f"  [{time.time() - t0:5.1f}s] 악기 합성")
    mix, gr = arrange(buses)
    print(f"  [{time.time() - t0:5.1f}s] 마스터(리미터 최대 GR {gr:.2f} dB)")
    res = analyze(mix)
    pcm = to_int16(mix)
    del mix
    out = os.path.abspath(args.out)
    od = os.path.dirname(out)
    os.makedirs(od, exist_ok=True)
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
    meta = {"duration": int(round(DUR)), "bpm": BPM, "key": KEY,
            "sections": [{"name": n, "start": int(tb(b))} for n, b in SECTIONS], "seed": SEED,
            "title": TITLE, "mood": MOOD}
    stem = os.path.splitext(os.path.basename(out))[0]
    with open(os.path.join(od, stem + ".json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs, brs = mp3_frames(mp3)
    info = {"mp3_secs": round(secs, 3), "bytes": len(mp3), "bitrates": brs, "sha256": hashlib.sha256(mp3).hexdigest(),
            "limiter_gr_db": round(gr, 2), "elapsed_s": round(time.time() - t0, 1)}
    ok = abs(secs - DUR) <= 0.5 and len(mp3) <= 8 * 1024 * 1024 and res["peak_db"] <= -1.0 \
        and abs(res["lufs"] - TARGET_LUFS) <= 1.0 and brs == [BITRATE * 1000]
    info["ok"] = bool(ok)
    print(f"MP3 {out}: {len(mp3):,} bytes, {secs:.3f}초, {brs}, 검사 {'통과' if ok else '실패'}")
    if not args.no_report:
        with open(os.path.join(od, f"report-{ID}.json"), "w", encoding="utf-8") as fh:
            json.dump({"id": ID, "analysis": res, "mp3": info}, fh, ensure_ascii=False, indent=1)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
