#!/usr/bin/env python3
"""점심시간 빅밴드 — 복셀 오피스 매우 활발(3단계) 배경음악.

빠른 스윙 빅밴드: 워킹 베이스, 라이드 스윙, 로즈 찰스턴 컴핑, 색소폰 4성 솔리 주제, 금관 샤우트 히트,
트럼펫 즉흥 라인, 필인·크래시. 점심시간 카페·바쁜 사무실의 유쾌한 소란.
192 BPM, 4/4, 240마디 = 정확히 300초, F major(16마디 형식 반복), 시드 2026 결정적 합성. 외부 샘플 없음.
처음과 끝은 같은 피아노 트리오(인트로·아웃트로)라 루프로 이어진다.

  python compose_swing.py --out <폴더>/bgm-swing.mp3
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

ID = "swing"
SEED = 2026
BPM = 192
BARS = 240
KEY = "F major"
TITLE = "점심시간 빅밴드"
MOOD = "매우 활발 · 빠른 스윙 빅밴드 — 워킹 베이스, 라이드, 색소폰 솔리, 금관 샤우트 히트, 트럼펫 라인, 유쾌한 점심시간 소란"
SECTIONS = [("인트로", 0), ("A · 주제", 16), ("그루브", 48), ("전개", 80), ("B", 128), ("클라이맥스", 160),
            ("A · 다시", 208), ("아웃트로", 224)]
SW = 0.62

FORM = [("F6", "D7"), ("Gm7", "C7"), ("F6", "D7"), ("Gm7", "C7"), ("F7", "F7"), ("Bb6", "Bdim7"), ("F/C", "D7"),
        ("Gm7", "C7"), ("A7", "A7"), ("A7", "A7"), ("D7", "D7"), ("D7", "D7"), ("G7", "G7"), ("C7", "C7"),
        ("F6", "D7"), ("Gm7", "C7")]


def cname(bar, beat=0.0):
    return FORM[(bar % BARS) % 16][0 if beat < 2 else 1]


def sb(slot):
    """스윙 8분 자리 → 박."""
    return slot // 2 + (SW if slot % 2 else 0.0)


def in_sec(bar, a, b):
    return a <= bar < b


SHOUT = [(48, 80), (160, 208)]
HEAD = [(16, 48), (128, 160), (208, 224)]
SOLO = (80, 128)


def walk(sc, bar0, bar1, vel):
    m = 41
    r = np.random.default_rng(7)
    for bar in range(bar0, bar1):
        for b in range(4):
            cn = cname(bar, b)
            nb_bar, nb = (bar, b + 1) if b < 3 else (bar + 1, 0)
            nn = cname(nb_bar, nb)
            pcs = chord_pcs(chord(cn))
            new = b == 0 or cn != cname(bar, b - 1)
            if new:
                root = chord(cn)[2]
                m = min((x for x in range(31, 51) if x % 12 == root), key=lambda x: abs(x - m))
            elif nn != cn:
                nr = chord(nn)[2]
                tgt = min((x for x in range(31, 51) if x % 12 == nr), key=lambda x: abs(x - m))
                m = tgt + (1 if r.random() < 0.5 else -1)
            else:
                m = nearest_pc(m + int(r.choice([-4, -3, -2, 2, 3, 4])), pcs)
                if m < 31:
                    m += 12
                if m > 50:
                    m -= 12
            sc.note("bass", tb(bar, b), "upright", m, BEAT * 0.85, vel * (1.0 if b % 2 == 0 else 0.9), 0, jit=0.004)


R1 = [(0, 1), (1, 1), (2, 2), (5, 1), (6, 2), (9, 1), (10, 1), (11, 3)]
R2 = [(1, 1), (2, 1), (3, 1), (4, 2), (7, 2), (10, 2), (12, 4)]
R3 = [(0, 2), (3, 1), (4, 1), (5, 1), (6, 1), (7, 2), (10, 1), (11, 4)]
R4 = [(0, 1), (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 2), (9, 1), (10, 1), (11, 1), (12, 3)]


def line(seed, bar0, tmpl, start, lo, hi):
    r = np.random.default_rng(seed)
    m, out = start, []
    for slot, ln in tmpl:
        bar = bar0 + slot // 8
        bt = sb(slot % 8)
        pcs = chord_pcs(chord(cname(bar, bt)))
        if slot % 2 == 0 or ln >= 2:
            m = nearest_pc(m + int(r.choice([-3, -2, 2, 3, 4, -5])), pcs)
        else:
            m = step_in(m, int(r.choice([-1, 1])), scale_of(5, "mixo") if r.random() < 0.3 else scale_of(5, "major"))
        while m > hi:
            m -= 12
        while m < lo:
            m += 12
        out.append((bar, bt, ln * 0.5 * BEAT * 0.92, m))
    return out


def harm(cn, lead, n=3):
    pcs = chord_pcs(chord(cn))
    vs, m = [], lead
    for _ in range(n):
        m -= 1
        while m % 12 not in pcs:
            m -= 1
        vs.append(m)
    return vs


def soli(sc, bar0, bars, vel, seeds=(31, 32, 33, 34)):
    tm = [R1, R1, R2, R3, R4, R2, R1, R3]
    for k in range(bars // 2):
        b = bar0 + 2 * k
        for bar, bt, d, m in line(seeds[k % len(seeds)], b, tm[k % 8], 74, 67, 79):
            v = vel * (0.9 + 0.2 * rng.random())
            t = tb(bar, bt)
            sc.note("sax", t, "sax", m, d, v, -0.2)
            for i, h in enumerate(harm(cname(bar, bt), m)):
                sc.note("sax", t, "sax", h, d, v * 0.8, -0.35 + 0.15 * i)


HITS = [[(0, 0.5), (1 + SW, 1.2), (3 + SW, 0.35)], [(0 + SW, 0.35), (1 + SW, 2.2)],
        [(0, 0.35), (1, 0.35), (2 + SW, 0.35), (3 + SW, 1.0)], [(SW, 0.35), (2, 0.5), (3, 0.9)]]


def shout(sc, bar0, bar1, vel):
    r = np.random.default_rng(41)
    lead = 77
    for bar in range(bar0, bar1):
        pat = HITS[(bar - bar0) % 4] if (bar - bar0) % 8 < 6 else HITS[(bar - bar0) % 2 + 2]
        for bt, d in pat:
            cn = cname(bar, bt)
            lead = nearest_pc(lead + int(r.choice([-2, -1, 1, 2, 3])), chord_pcs(chord(cn)))
            lead = min(max(lead, 70), 81)
            t = tb(bar, bt)
            dd = d * BEAT
            sc.note("brass", t, "brass", lead, dd, vel, 0.25)
            for i, h in enumerate(harm(cn, lead, 4)):
                sc.note("brass", t, "brass" if i < 2 else "brassd", h, dd, vel * 0.8, 0.1 + 0.08 * i)
            # 색소폰은 한 옥타브 아래로 겹침
            sc.note("sax", t, "sax", lead - 12, dd, vel * 0.6, -0.3)
            sc.hit("drums", t, "snare", 0.35, 0.05)
            sc.hit("kick", t, "kick", 0.45)
        if (bar - bar0) % 2 == 1:
            # 히트 사이 색소폰 8분 응답
            for bar_, bt, d, m in line(51 + (bar - bar0) % 6, bar, R4[:6], 70, 62, 76):
                sc.note("sax", tb(bar_, bt) + 0.0, "sax", m, d, vel * 0.55, -0.25)


def drums(sc):
    for bar in range(BARS):
        trio = bar < 16 or bar >= 224
        loud = any(in_sec(bar, a, b) for a, b in SHOUT)
        rv = 0.28 if trio else 0.45 if not loud else 0.5
        for bt, a in ((0, 0.8), (1, 1.0), (1 + SW, 0.6), (2, 0.8), (3, 1.0), (3 + SW, 0.6)):
            sc.hit("drums", tb(bar, bt), "ride", rv * a, 0.3)
        for bt in (1, 3):
            sc.hit("drums", tb(bar, bt), "hatpedal" if not trio else "brush", 0.3, -0.2)
        for bt in range(4):
            sc.hit("kick", tb(bar, bt), "kick", 0.12 if trio else 0.18)
        if not trio:
            for s in range(8):
                if rng.random() < 0.22:
                    sc.hit("drums", tb(bar, sb(s)), "ghost", 0.12 + 0.1 * rng.random(), 0.05)
        # 8마디마다 필인, 다음 마디 첫 박 크래시
        if not trio and bar % 8 == 7:
            for s in range(4, 8):
                k = "tom" if s >= 6 and loud else "snare"
                sc.hit("drums", tb(bar, sb(s)), k, 0.3 + 0.05 * s, 0.1 - 0.05 * (s - 4))
            sc.hit("cym", tb(bar + 1), "crash", 0.35 if loud or bar + 1 in (48, 160, 208) else 0.2, -0.3)


def compose():
    sc = Score()
    walk(sc, 0, BARS, 0.8)
    drums(sc)
    # 로즈 찰스턴 컴핑(전 구간, 샤우트에선 조금 여리게)
    prev = None
    r = np.random.default_rng(3)
    for bar in range(BARS):
        for half in (0, 2):
            cn = cname(bar, half)
            vo = voicing(chord(cn), 55, 70, prev, rootless=True)
            prev = vo
            opts = [[(half, 0.6), (half + 1 + SW, 0.4)], [(half + SW, 0.5)], [(half + 1 + SW, 0.6)], [(half, 1.6)]]
            pv = 0.3 if any(in_sec(bar, a, b) for a, b in SHOUT) else 0.4
            for bt, d in opts[int(r.integers(4))]:
                for i, m in enumerate(vo):
                    sc.note("piano", tb(bar, bt) + 0.004 * i, "epiano", m, d * BEAT, pv, -0.4)
    # 주제: 색소폰 솔리 + 금관 배경 긴음
    for a, b in HEAD:
        soli(sc, a, b - a, 0.5)
        for bar in range(a, b, 2):
            vo = voicing(chord(cname(bar)), 58, 72, None, rootless=True)
            for i, m in enumerate(vo):
                sc.note("brass", tb(bar), "brassd", m, BAR * 1.8, 0.2, 0.2 + 0.05 * i)
    # 샤우트
    for a, b in SHOUT:
        shout(sc, a, b, 0.62 if a == 48 else 0.68)
    # 트럼펫 즉흥(2마디 말하고 2마디 쉼 + 색소폰 배경)
    tm = [R4, R3, R1, R4, R2, R4]
    for k, bar in enumerate(range(SOLO[0], SOLO[1], 4)):
        for bar_, bt, d, m in line(61 + k, bar, tm[k % 6], 72, 65, 82):
            sc.note("lead", tb(bar_, bt), "brass", m, d, 0.55 * (0.9 + 0.2 * rng.random()), 0.15)
        for i, m in enumerate(voicing(chord(cname(bar + 2)), 58, 70, None, rootless=True)):
            sc.note("sax", tb(bar + 2), "sax", m, BAR * 1.9, 0.22, -0.3 + 0.1 * i)
    return sc


def arrange(buses):
    spec = {
        "bass": (0.42, 1200, 35, 0.05, None),
        "piano": (0.7, 5000, 120, 0.25, None),
        "sax": (0.5, 5000, 120, 0.30, None),
        "brass": (0.8, 5000, 150, 0.30, None),
        "lead": (1.7, 5000, 150, 0.30, None),
        "drums": (1.7, 9000, 150, 0.15, None),
        "cym": (1.0, 7000, 800, 0.2, None),
        "kick": (0.85, 3000, 30, 0.03, None),
    }
    master = [(0, 1.15), (15, 1.15), (16, 0.95), (48, 1.0), (80, 0.95), (160, 1.0), (208, 0.95), (223, 0.95), (224, 1.15), (240, 1.15)]
    return mixdown(buses, spec, master, rev_gain=0.22, rev=(2.0, 1.4, 0.5))

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
