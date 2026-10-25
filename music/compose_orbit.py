#!/usr/bin/env python3
"""'궤도 표류' 스페이스 앰비언트 BGM 결정적 합성기 (활동 단계 0 · 한가).

비트 없는 스페이스 앰비언트: 깊은 서브 드론, 디튠 패드와 그래뉼러 반짝임, 느린 필터 스윕,
멀리서 울리는 벨·글래스 하모닉스, 넓은 스테레오와 긴 리버브. D 리디안(G# 색채음), 무중력·평온.
마스터링·원형 버퍼 루프·검사·MP3 파이프라인은 music/compose_lofi.py 를 복사해 재사용한다.

60 BPM 4/4 75마디(마디 4초) = 정확히 300초.
  기  드론(0～10) · 먼 벨(10～20)                서브 드론과 먼 벨 → 그래뉼러 반짝임, 14마디부터 닫힌 패드
  승  패드 전개(20～37)                          Dmaj9–E/D–Bm9–Aadd9, 필터가 천천히 열림
  전  화성 전환(37～45) · 하모닉스 고조(45～53)    Bbmaj9#11–C/Bb–Gmaj9#11–A/G → Emaj9–F#m11–Gmaj9#11–A/G, 글래스 상승 음형
  결  회귀(53～63) · 드론 귀환(63～75)            Dmaj9–E/D 로 돌아와 패드가 빠지고 드론과 먼 벨만(처음으로 이어짐)

사용법:
  python compose_orbit.py --out bgm-orbit.mp3 [--wav 미리듣기.wav]
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

SEED = 2026
SR = 44100
BPM = 60
BEAT = 60.0 / BPM
BAR = 4 * BEAT                 # 4 s
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
TITLE = "궤도 표류"
MOOD = "스페이스 앰비언트 · 무중력 드론·패드·먼 벨, 비트 없음"
KEY_NAME = "D lydian"
STAGE = 0
ENERGY = 0.12

rng = np.random.default_rng(SEED)
F32 = np.float32

# ───────────────────────── 화음(MIDI 보이싱 직접 지정) ─────────────────────────

CH = {
    "Dmaj9#11": [50, 57, 61, 64, 68],     # D3 A3 C#4 E4 G#4
    "Dmaj9": [50, 57, 61, 64, 66],        # D3 A3 C#4 E4 F#4
    "E/D": [50, 56, 59, 64, 66],          # D3 G#3 B3 E4 F#4
    "Bm9": [47, 54, 57, 61, 62],          # B2 F#3 A3 C#4 D4
    "Aadd9": [45, 52, 59, 61, 64],        # A2 E3 B3 C#4 E4
    "Bbmaj9#11": [46, 53, 57, 60, 64],    # Bb2 F3 A3 C4 E4
    "C/Bb": [46, 52, 55, 60, 62],         # Bb2 E3 G3 C4 D4
    "Gmaj9#11": [43, 50, 54, 57, 61],     # G2 D3 F#3 A3 C#4
    "A/G": [43, 52, 57, 61, 64],          # G2 E3 A3 C#4 E4
    "Emaj9": [40, 47, 56, 63, 66],        # E2 B2 G#3 D#4 F#4
    "F#m11": [42, 49, 52, 57, 59],        # F#2 C#3 E3 A3 B3
}
# 벨·글래스 선율용 음계(화음 음 + 리디안 색채음)
COLOR = {"Dmaj9#11": [2, 4, 6, 8, 9, 1], "Dmaj9": [2, 4, 6, 9, 1, 8], "E/D": [4, 8, 11, 2, 6],
         "Bm9": [11, 2, 6, 9, 1], "Aadd9": [9, 1, 4, 11, 8], "Bbmaj9#11": [10, 2, 5, 9, 0, 4],
         "C/Bb": [0, 4, 7, 10, 2], "Gmaj9#11": [7, 11, 2, 6, 9, 1], "A/G": [9, 1, 4, 7, 11],
         "Emaj9": [4, 8, 11, 3, 6], "F#m11": [6, 9, 1, 4, 11]}

SECS = [
    dict(n="드론", part="기", bars=10, prog=["Dmaj9#11"], filt=0.05, drone=1.0, pad=0.0, gran=0.15,
         bell=(7.0, 11.0), glass=0.0, wind=1.0,
         desc="깊은 서브 드론(D1·D2·A2)과 우주 바람, 멀리서 드문드문 울리는 벨"),
    dict(n="먼 벨", part="기", bars=10, prog=["Dmaj9#11"], filt=0.12, drone=1.0, pad=0.45, pad_from=4, gran=0.6,
         bell=(4.5, 7.5), glass=0.0, wind=0.9,
         desc="벨이 잦아지고 그래뉼러 반짝임이 깔림, 14마디부터 필터 닫힌 Dmaj9#11 패드"),
    dict(n="패드 전개", part="승", bars=17, prog=["Dmaj9", "E/D", "Bm9", "Aadd9"], filt=0.45, drone=0.85, pad=1.0,
         gran=1.4, bell=(3.0, 5.0), glass=0.0, wind=0.7,
         desc="디튠 패드 화성 전개(Dmaj9–E/D–Bm9–Aadd9), 느린 필터 스윕으로 열림"),
    dict(n="화성 전환", part="전", bars=8, prog=["Bbmaj9#11", "C/Bb", "Gmaj9#11", "A/G"], filt=0.72, drone=0.55,
         pad=1.05, gran=2.4, bell=(2.0, 3.5), glass=0.55, wind=0.6,
         desc="Bb 리디안→G 리디안으로 화성 전환, 글래스 하모닉스 진입"),
    dict(n="하모닉스 고조", part="전", bars=8, prog=["Emaj9", "F#m11", "Gmaj9#11", "A/G"], filt=0.95, drone=0.45,
         pad=1.12, gran=3.4, bell=(1.6, 2.6), glass=1.0, rise=True, wind=0.6,
         desc="가장 밝은 필터, 글래스 상승 음형과 촘촘한 그래뉼러, A/G 에서 D로 귀결 준비"),
    dict(n="회귀", part="결", bars=10, prog=["Dmaj9", "E/D", "Dmaj9", "E/D", "Dmaj9"], filt=0.35, drone=0.9,
         pad=0.8, gran=1.0, bell=(4.0, 6.5), glass=0.2, wind=0.8,
         desc="Dmaj9–E/D 로 돌아오며 필터가 닫히고 하모닉스가 잦아듦"),
    dict(n="드론 귀환", part="결", bars=12, prog=["Dmaj9#11"], filt=0.06, drone=1.0, pad=0.4, pad_to=3, gran=0.2,
         bell=(7.0, 11.0), glass=0.0, wind=1.0,
         desc="패드가 3마디 안에 빠지고 드론·바람·먼 벨만 남아 처음으로 이어짐"),
]
_b = 0
for _i, _s in enumerate(SECS):
    _s["i"] = _i
    _s["start"] = _b
    _b += _s["bars"]
BARS = _b                                     # 75
DUR = BARS * BAR                              # 300.000 s
N = int(round(DUR * SR))                      # 13,230,000
assert BARS == 75 and N == 13230000


def sec_at_bar(b):
    for s in SECS:
        if s["start"] <= b < s["start"] + s["bars"]:
            return s
    return SECS[-1]


def chord_at(t):
    b = int(t // BAR) % BARS
    s = sec_at_bar(b)
    bl = b - s["start"]
    return s["prog"][(bl // 2) % len(s["prog"])]


# ───────────────────────── 기본 유틸(compose_lofi.py 에서 복사) ─────────────────────────

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


def section_curve(key, default, tau=6.0):
    """섹션 값(필터·드론 세기 등)을 1차 지수 추종으로 부드럽게, 원형으로 두 바퀴 돌려 루프 정상 상태로."""
    cr = 200
    nc = int(DUR * cr)
    tgt = np.zeros(nc)
    for s in SECS:
        i0 = int(round(tb(s["start"]) * cr))
        i1 = int(round(tb(s["start"] + s["bars"]) * cr))
        tgt[i0:i1] = s.get(key, default)
    a = 1 - math.exp(-1 / (cr * tau))
    y = np.empty(nc)
    v = tgt[-1]
    for _ in range(2):
        for i in range(nc):
            v += a * (tgt[i] - v)
            y[i] = v
    tc = np.arange(nc) / cr
    return np.interp(np.arange(N) / SR, tc, y, period=DUR)


# ───────────────────────── 파형 표 ─────────────────────────

def _table(kind):
    ph = np.arange(4096) / 4096
    y = np.zeros(4096)
    if kind == "tri":
        for k in range(1, 16, 2):
            y += ((-1) ** ((k - 1) // 2)) * np.sin(2 * np.pi * k * ph) / (k * k)
        y *= 8 / np.pi ** 2
    else:                                          # 부드러운 톱니(12차, 1/k^1.35 감쇠)
        for k in range(1, 13):
            y += np.sin(2 * np.pi * k * ph) / k ** 1.35
        y /= np.abs(y).max()
    return y


TAB = {"tri": _table("tri"), "saw": _table("saw")}


def wave(kind, freq, t, ph0=0.0):
    idx = ((ph0 + freq * t) * 4096.0).astype(np.int64) & 4095
    return TAB[kind][idx]


def env_ar(dur, a, rel, sus_tau=None):
    """선형 상승 a → (선택) 완만한 감쇠 → 끝에서 rel 시상수로 꺼짐(꼬리 5·rel)."""
    end = max(dur, a + 0.01)
    n = int((end + rel * 5) * SR)
    t = np.arange(n) / SR
    na = min(n, int(a * SR))
    e = np.ones(n)
    e[:na] = 0.5 - 0.5 * np.cos(np.pi * t[:na] / a)   # 부드러운 S자 어택
    if sus_tau:
        e = e * (0.75 + 0.25 * np.exp(-np.maximum(t - a, 0) / sus_tau))
    ie = int(end * SR)
    if ie < n:
        e[ie:] = e[ie - 1] * np.exp(-(t[ie:] - end) / rel)
    return t, e


# ───────────────────────── 악기 ─────────────────────────

def ins_pad(m, dur, v, spread):
    """디튠 패드: 부드러운 톱니 3성부(±11센트) + 삼각파 한 옥타브 아래 성분, 성부별 좌우 배치."""
    f = mtof(m)
    t, e = env_ar(dur, min(3.2, dur * 0.45), 1.3, sus_tau=6.0)
    out = np.zeros((2, len(t)), dtype=F32)
    for k, (cents, pan) in enumerate(((-11, -spread), (0.5, 0.0), (11, spread))):
        fk = f * 2 ** ((cents + rng.uniform(-2, 2)) / 1200)
        y = wave("saw", fk, t, rng.random()) * (0.8 if k != 1 else 0.55)
        gl, gr = pan_gains(pan)
        out[0] += y * gl
        out[1] += y * gr
    sub = wave("tri", f * 0.5 * 2 ** (3 / 1200), t, rng.random()) * 0.35
    out += (sub * 0.7).astype(F32)[None, :]
    out *= (e * v).astype(F32)[None, :]
    return out


def ins_grain(m, dur, v):
    f = mtof(m) * 2 ** (rng.uniform(-6, 6) / 1200)
    n = int(dur * SR)
    t = np.arange(n) / SR
    w = np.sin(np.pi * np.arange(n) / n) ** 2
    y = np.sin(2 * np.pi * f * t + rng.random() * 6.283) + 0.18 * np.sin(4 * np.pi * f * t)
    return (y * w * v).astype(F32)


def ins_bell(m, dur, v):
    """먼 벨: 비조화 배음(1·2·2.76·4.07·5.4), 8 ms 부드러운 어택, 7 kHz 이상 배음은 뺀다."""
    f = mtof(m)
    parts = [(1.0, 1.0, 4.5), (2.0, 0.32, 2.6), (2.76, 0.22, 1.6), (4.07, 0.10, 0.9), (5.4, 0.05, 0.55)]
    L = 14.0
    n = int(L * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, vol, tau in parts:
        if f * k > 7000:
            continue
        y += np.sin(2 * np.pi * f * k * t + k) * vol * np.exp(-t / tau)
    a = int(0.008 * SR)
    y[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    y[-int(0.3 * SR):] *= np.linspace(1, 0, int(0.3 * SR))
    return (y * v).astype(F32)


def ins_glass(m, dur, v):
    """글래스 하모닉스: 느린 어택(0.35 s)의 사인 + 약한 2·3배음, 4.6 Hz 미세 비브라토."""
    f = mtof(m)
    t, e = env_ar(dur, 0.35, 1.4, sus_tau=2.5)
    vib = 1 + 0.0018 * np.sin(2 * np.pi * 4.6 * t + rng.random() * 6.283) * np.minimum(1, t / 0.8)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    y = np.sin(ph) + 0.10 * np.sin(2 * ph) + (0.03 * np.sin(3 * ph) if f * 3 < 7000 else 0)
    return (y * e * v).astype(F32)


# ───────────────────────── 사건 생성 ─────────────────────────

def walk(cur, pcs, lo, hi, r):
    cand = [m for m in range(lo, hi + 1) if m % 12 in pcs]
    near = sorted(cand, key=lambda m: abs(m - cur))[:5]
    w = np.array([0.6, 1.0, 1.0, 0.7, 0.4][:len(near)])
    return int(near[r.choice(len(near), p=w / w.sum())])


def build_events():
    r = np.random.default_rng(SEED + 1)
    ev = []
    # 패드: 2마디마다 화음, 8.6초 길이로 앞뒤 화음과 교차
    for s in SECS:
        if s["pad"] <= 0:
            continue
        b0 = s["start"] + s.get("pad_from", 0)
        b1 = s["start"] + s.get("pad_to", s["bars"])
        b = b0
        while b < b1:
            nm = s["prog"][((b - s["start"]) // 2) % len(s["prog"])]
            ln = min(2, b1 - b)
            for j, m in enumerate(CH[nm]):
                ev.append(dict(ins="pad", t=tb(b) + j * 0.06, m=m, d=ln * BAR + 0.8,
                               v=0.030 * s["pad"] * (1.15 if j == 0 else 1.0), spread=0.55 + 0.1 * j))
            b += ln
    # 그래뉼러 반짝임: 화음 음 +1·+2옥타브, 짧은 Hann 낱알, 섹션 밀도(초당)
    t = 0.0
    while t < DUR:
        s = sec_at_bar(int(t // BAR))
        dens = max(0.1, s["gran"]) * 2.2
        t += r.exponential(1.0 / dens)
        if t >= DUR or s["gran"] <= 0:
            continue
        nm = chord_at(t)
        m = int(r.choice(CH[nm][1:])) + int(r.choice([12, 12, 24]))
        while m > 88:
            m -= 12
        ev.append(dict(ins="grain", t=t, m=m, d=float(r.uniform(0.09, 0.34)), v=0.032 * float(r.uniform(0.5, 1.0)),
                       pan=float(r.uniform(-0.9, 0.9))))
    # 먼 벨: 섹션별 간격, 음계 위 무작위 걸음
    t = 1.5
    cur = 78
    while t < DUR:
        s = sec_at_bar(int(t // BAR))
        nm = chord_at(t)
        cur = walk(cur, COLOR[nm], 72, 88, r)
        ev.append(dict(ins="bell", t=t, m=cur, d=6.0, v=0.05 * float(r.uniform(0.7, 1.0)),
                       pan=float(r.uniform(-0.7, 0.7))))
        lo, hi = s["bell"]
        t += float(r.uniform(lo, hi))
    # 글래스 하모닉스: 지속음 + 고조 구간의 상승 3음 음형
    gcur = 83
    for s in SECS:
        if s["glass"] <= 0:
            continue
        t = tb(s["start"]) + 0.5
        t1 = tb(s["start"] + s["bars"])
        while t < t1 - 1.0:
            nm = chord_at(t)
            gcur = walk(gcur, COLOR[nm], 79, 91, r)
            ev.append(dict(ins="glass", t=t, m=gcur, d=float(r.uniform(2.5, 4.0)), v=0.024 * s["glass"],
                           pan=float(r.uniform(-0.6, 0.6))))
            t += float(r.uniform(3.0, 5.0)) / max(0.6, s["glass"])
        if s.get("rise"):
            for b in range(s["start"], s["start"] + s["bars"]):
                nm = chord_at(tb(b) + 0.1)
                tones = sorted({m + 24 for m in CH[nm][1:] if 74 <= m + 24 <= 92} |
                               {m + 36 for m in CH[nm][1:] if 74 <= m + 36 <= 92})
                if len(tones) < 3:
                    continue
                k0 = int(r.integers(0, len(tones) - 2))
                for j in range(3):
                    ev.append(dict(ins="glass", t=tb(b, 1.0 + j * 0.5), m=tones[k0 + j], d=1.8,
                                   v=0.016 * (0.8 + 0.15 * j), pan=(-0.5 + 0.5 * j) * (1 if b % 2 else -1)))
    ev.sort(key=lambda e: (e["t"], e["ins"], e["m"]))
    return ev


# ───────────────────────── 이펙트 ─────────────────────────

def reverb_ir(length=8.0, rt60_lo=7.0, rt60_hi=3.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.035 * SR)
    fr = np.fft.rfftfreq(n, 1 / SR)
    for ch in range(2):
        spec = np.fft.rfft(rng.standard_normal(n))
        lo = np.fft.irfft(spec * lp_mag(fr, 1500, 1), n=n)
        hi = np.fft.irfft(spec * hp_mag(fr, 1500, 1), n=n)
        tail = lo * np.exp(-6.91 * t / rt60_lo) + hi * np.exp(-6.91 * t / rt60_hi)
        tail *= 1 - np.exp(-t / 0.12)              # 천천히 피어나는 꼬리
        ir[ch, pre:] = tail[: n - pre]
    ir[:, -int(0.2 * SR):] *= np.linspace(1, 0, int(0.2 * SR))[None, :]
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


def echo_ir(delay=1.5, fb=0.5, taps=8):
    n = int(delay * (taps + 1) * SR) + 16
    ir = np.zeros((2, n))
    for k in range(1, taps + 1):
        ir[(k + 1) % 2, int(k * delay * SR)] = fb ** (k - 1) * 0.6
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * lp_mag(fr, 2600, 1), n=n, axis=1)
    return ir.astype(F32)


def drone_bus(level):
    """서브 드론: D1·D2(좌우 0.06 Hz 어긋남으로 느린 맥놀이)·A2·D3, 주파수와 LFO 모두 300초 정수 주기."""
    out = new_bus()
    CHK = 1 << 20
    parts = [  # (주파수, 좌 세기, 우 세기, 우 주파수 오프셋, 진폭 LFO Hz, LFO 깊이)
        (mtof(26), 0.42, 0.42, 0.0, 1 / 30, 0.15),
        (mtof(38), 0.55, 0.55, 0.06, 1 / 23, 0.25),
        (mtof(45), 0.13, 0.10, 0.04, 1 / 37, 0.5),
        (mtof(50), 0.05, 0.07, 0.09, 1 / 17, 0.6),
    ]
    ph = [(rng.random() * 6.283, rng.random() * 6.283) for _ in parts]
    for i0 in range(0, N, CHK):
        t = np.arange(i0, min(N, i0 + CHK), dtype=np.float64) / SR
        for (f, gl, gr, df, lf, dp), (p0, p1) in zip(parts, ph):
            am = 1 - dp * (0.5 + 0.5 * np.sin(2 * np.pi * loopf(lf) * t + p0))
            out[0, i0:i0 + len(t)] += (gl * am * np.sin(2 * np.pi * loopf(f) * t + p0)).astype(F32)
            out[1, i0:i0 + len(t)] += (gr * am * np.sin(2 * np.pi * loopf(f + df) * t + p1)).astype(F32)
    y = np.tanh(1.2 * out) / np.tanh(1.2)          # 작은 스피커용 약한 배음
    return (y * level.astype(F32)[None, :]).astype(F32)


def wind_bus(level):
    """우주 바람: 대역 잡음 두 개(350 Hz·900 Hz)를 느린 LFO로 교차, 좌우 독립."""
    f = freqs()
    nz = rng.standard_normal((2, N), dtype=F32)
    a = fd_filter(nz, bpq(f, 350, 1.2))
    b = fd_filter(nz[::-1].copy(), bpq(f, 900, 1.5))
    del nz
    t = np.arange(N, dtype=np.float64) / SR
    x = (0.5 + 0.5 * np.sin(2 * np.pi * loopf(1 / 43) * t)).astype(F32)
    sw = (0.6 + 0.4 * np.sin(2 * np.pi * loopf(1 / 19) * t + 1.3)).astype(F32)
    del t
    y = (a * (1 - x)[None, :] + b * 0.6 * x[None, :]) * sw[None, :]
    y *= F32(1.0 / np.sqrt((y.astype(np.float64) ** 2).mean()))
    return y * level.astype(F32)[None, :]


# ───────────────────────── 측정·마스터링(compose_lofi.py 에서 복사) ─────────────────────────

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
    y = (x * g[None, :]).astype(F32)
    return y, float(20 * np.log10(g.min()))


# ───────────────────────── 조립 ─────────────────────────

BUS_OF = {"pad": "pad", "grain": "grain", "bell": "bell", "glass": "glass"}


def synth(e):
    ins, d, v = e["ins"], e["d"], e["v"]
    if ins == "pad":
        return ins_pad(e["m"], d, v, e["spread"]), 0.0
    if ins == "grain":
        return ins_grain(e["m"], d, v), e["pan"]
    if ins == "bell":
        return ins_bell(e["m"], d, v), e["pan"]
    if ins == "glass":
        return ins_glass(e["m"], d, v), e["pan"]
    raise ValueError(ins)


def bus_rms(x):
    return db(float(np.sqrt((x.astype(np.float64) ** 2).mean())))


def _fast_len(n):
    """2·3·5 소인수만 가진 수 중 n 이상 최소값(음마다 FFT를 빠르게)."""
    best = 1 << (n - 1).bit_length()
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            p = p35
            while p < n:
                p *= 2
            best = min(best, p)
            p35 *= 3
        p5 *= 5
    return best


def render(events, log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()
    by_bus = {}
    for e in events:
        by_bus.setdefault(BUS_OF[e["ins"]], []).append(e)

    dry = new_bus()
    rev = new_bus()
    echo = new_bus()
    stats = {}

    # 패드 + 느린 필터 스윕(닫힌 380 Hz 판본과 열린 3.2 kHz 판본을 섹션 곡선 + 60초 LFO로 교차)
    bus = new_bus()
    for e in by_bus.get("pad", []):
        sig, pan = synth(e)
        add(bus, e["t"], sig, pan)
    filt = section_curve("filt", 0.1, tau=7.0)
    t = np.arange(N, dtype=np.float64) / SR
    w = np.clip(filt + 0.12 * np.sin(2 * np.pi * loopf(1 / 60) * t) * (0.3 + filt), 0, 1)
    del t
    w = (w ** 1.3).astype(F32)[None, :]
    lo = fd_filter(bus, lpq(f, 380, 0.9) * hp_mag(f, 45, 1))
    bus = fd_filter(bus, lpq(f, 3200, 0.9) * hp_mag(f, 45, 1))
    bus -= lo
    bus *= w
    bus += lo
    del lo, w
    stats["pad"] = bus_rms(bus)
    dry += F32(0.8) * bus
    rev += F32(0.45) * bus
    del bus
    st(f"pad: {len(by_bus.get('pad', []))}음, 필터 스윕")

    SEND = {"grain": (0.55, 0.7, 0.15), "bell": (0.35, 0.9, 0.35), "glass": (0.6, 0.65, 0.25)}
    LPF = {"grain": 4200, "bell": 3600, "glass": 5500}
    for name in ("grain", "bell", "glass"):
        # 음마다 짧은 FFT로 대역 제한(전체 길이 버스 FFT를 피해 실행 시간·메모리 절약) 후 세 버스로 바로 보냄
        dg, rs, es = SEND[name]
        en = 0.0
        for e in by_bus.get(name, []):
            sig, pan = synth(e)
            n = _fast_len(len(sig) + 4096)
            fr = np.fft.rfftfreq(n, 1 / SR)
            sig = np.fft.irfft(np.fft.rfft(sig, n=n) * lpq(fr, LPF[name], 0.7) * hp_mag(fr, 200, 1), n=n)
            gl, gr_ = pan_gains(pan)
            st2 = np.stack([sig * gl, sig * gr_]).astype(F32)
            en += float((st2.astype(np.float64) ** 2).sum())
            add(dry, e["t"], F32(dg) * st2)
            add(rev, e["t"], F32(rs) * st2)
            add(echo, e["t"], F32(es) * st2)
        stats[name] = db(math.sqrt(en / (2 * N)))
        st(f"{name}: {len(by_bus.get(name, []))}음")

    lvl = section_curve("drone", 1.0, tau=8.0)
    dr = drone_bus(lvl)
    del lvl
    dr = fd_filter(dr, hp_mag(f, 40, 1) * hp_mag(f, 22, 2) * lpq(f, 400, 0.7))   # 40 Hz 아래 완만한 하이패스(1차) + 22 Hz 초저역 차단
    stats["drone"] = bus_rms(dr)
    dry += F32(0.0315) * dr       # 서브 드론 −4 dB(헤드폰 웅웅거림 방지), 줄어든 만큼 마스터 LUFS 정규화로 패드·벨이 올라감
    rev += F32(0.0315) * dr
    del dr
    st("drone")

    lvl = section_curve("wind", 1.0, tau=8.0)
    wd = wind_bus(lvl)
    del lvl
    dry += F32(0.006) * wd
    rev += F32(0.006) * wd
    stats["wind"] = bus_rms(F32(0.006) * wd)
    del wd
    st("wind")

    ec = circ_conv(echo.mean(axis=0), echo_ir())
    dry += F32(0.6) * ec
    rev += F32(0.5) * ec
    del ec, echo
    st("echo")

    wet = circ_conv(rev, reverb_ir())
    del rev
    wet = fd_filter(wet, hp_mag(f, 120, 1) * lpq(f, 3000, 0.7))
    stats["reverb"] = bus_rms(wet)
    # 넓은 스테레오: 리버브 꼬리의 사이드 성분을 키움
    mid = (wet[0] + wet[1]) * F32(0.5)
    side = (wet[0] - wet[1]) * F32(0.5 * 1.35)
    wet[0] = mid + side
    wet[1] = mid - side
    del mid, side
    dry += F32(0.75) * wet
    del wet
    st("reverb")
    log("  버스 RMS(dBFS, 믹스 전): " + ", ".join(f"{k} {v:.1f}" for k, v in stats.items()))

    mix = dry
    mix = fd_filter(mix, hp_mag(f, 24, 2) * lpq(f, 9000, 0.7))

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
    y = np.round(x * F32(32767.0) + d)
    return np.clip(y, -32768, 32767).astype(np.int16)


def encode_mp3(pcm16):
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(BITRATE)
    enc.set_in_sample_rate(SR)
    enc.set_channels(2)
    enc.set_quality(2)
    inter = np.ascontiguousarray(pcm16.T).tobytes()
    return bytes(enc.encode(inter)) + bytes(enc.flush())


def mp3_frames(data):
    br_tab = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    sr_tab = [44100, 48000, 32000, 0]
    i, frames, sr = 0, 0, SR
    brs = set()
    if data[:3] == b"ID3":
        sz = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        i = 10 + sz
    while i + 4 <= len(data):
        h = data[i:i + 4]
        if h[0] != 0xFF or (h[1] & 0xE0) != 0xE0:
            i += 1
            continue
        br = br_tab[(h[2] >> 4) & 0xF] * 1000
        sr = sr_tab[(h[2] >> 2) & 3]
        pad = (h[2] >> 1) & 1
        if br == 0 or sr == 0:
            i += 1
            continue
        frames += 1
        brs.add(br)
        i += 144 * br // sr + pad
    return frames, frames * 1152 / sr, brs


# ───────────────────────── 분석·보고 ─────────────────────────

def db(v):
    return 20 * math.log10(max(v, 1e-12))


def mmss(t):
    t = int(round(t))
    return f"{t // 60}:{t % 60:02d}"


def stft_power(mono, nfft=4096, hop=2048):
    win = np.hanning(nfft).astype(F32)
    nfr = (len(mono) - nfft) // hop + 1
    P = np.empty((nfr, nfft // 2 + 1), dtype=F32)
    for c0 in range(0, nfr, 512):
        c1 = min(nfr, c0 + 512)
        idx = np.arange(c0, c1)[:, None] * hop + np.arange(nfft)[None, :]
        P[c0:c1] = (np.abs(np.fft.rfft(mono[idx] * win, axis=1)) ** 2).astype(F32)
    return P, np.fft.rfftfreq(nfft, 1 / SR), (np.arange(nfr) * hop + nfft / 2) / SR


def analyze(x, outdir, mp3info, gr, wall, events):
    L = []
    mono = x.mean(axis=0).astype(F32)
    P, fr, tfr = stft_power(mono)
    del mono

    def centroid(t0, t1):
        m = (tfr >= t0) & (tfr < t1)
        p = P[m].astype(np.float64).sum(axis=0)
        return float((fr * p).sum() / p.sum())

    def hf_ratio(t0, t1, fc=8000):
        m = (tfr >= t0) & (tfr < t1)
        p = P[m].astype(np.float64).sum(axis=0)
        return db(math.sqrt(p[fr >= fc].sum() / p.sum()))

    def seg_stats(t0, t1):
        seg = x[:, int(t0 * SR):int(t1 * SR)].astype(np.float64)
        return db(math.sqrt((seg ** 2).mean())), db(np.abs(seg).max()), loudness(seg)

    cnt = {}
    for e in events:
        cnt[e["ins"]] = cnt.get(e["ins"], 0) + 1
    L.append(f"# {TITLE} — 5분 스페이스 앰비언트 BGM 합성 보고\n")
    L.append(f"- 활동 단계 {STAGE}(한가) 용, 에너지 {ENERGY}, {BPM} BPM(비트 없음, 마디 4초), {KEY_NAME}")
    L.append(f"- 길이 {DUR:.3f}초 = {BARS}마디 × {BAR:.1f}초, 44.1kHz 스테레오, 시드 {SEED}(numpy)")
    L.append(f"- 사건 {len(events):,}개(" + ", ".join(f"{k} {v}" for k, v in cnt.items())
             + f"), 합성·분석 소요 {wall:.1f}초, 리미터 최대 감쇠 {gr:.2f} dB\n")

    L.append("## 곡 구조\n")
    L.append("| 단계 | 구간 | 시간 | 마디 | 화성 | 내용 |")
    L.append("|---|---|---|---|---|---|")
    for s in SECS:
        t0, t1 = tb(s["start"]), tb(s["start"] + s["bars"])
        L.append(f"| {s['part']} | {s['n']} | {mmss(t0)}～{mmss(t1)} | {s['start']}～{s['start'] + s['bars'] - 1} | "
                 f"{'–'.join(s['prog'])} | {s['desc']} |")
    L.append("\n- 음색: 서브 드론(D1·D2·A2·D3 사인, 좌우 0.04～0.09 Hz 맥놀이, 약한 tanh), 디튠 패드(부드러운 톱니 3성부 ±11센트 + "
             "옥타브 아래 삼각파), 그래뉼러 낱알(90～340 ms Hann, 화음 음 +1·2옥타브), 먼 벨(비조화 배음 1·2·2.76·4.07·5.4, "
             "8 ms 어택), 글래스 하모닉스(0.35 s 어택 사인, 4.6 Hz 비브라토), 우주 바람(대역 잡음 350·900 Hz 교차)")
    L.append("- 이펙트: 패드 필터 스윕(380 Hz↔3.2 kHz, 섹션 곡선 + 60초 LFO), 1.5초 핑퐁 에코(벨·글래스·낱알), "
             "8초 합성 IR 리버브(RT60 저역 7초·고역 3.2초, 사이드 ×1.35 확장), 서브 드론 40 Hz 아래 1차 하이패스·−4 dB, 마스터 9 kHz 저역 통과\n")

    L.append("## 구간별 에너지·밝기\n")
    L.append("| 구간 | 시간 | RMS(dBFS) | 피크(dBFS) | LUFS(근사) | 스펙트럼 중심(Hz) | 8kHz 이상 에너지(dB) |")
    L.append("|---|---|---|---|---|---|---|")
    for s in SECS:
        t0, t1 = tb(s["start"]), tb(s["start"] + s["bars"])
        r_, p_, l_ = seg_stats(t0, t1)
        L.append(f"| {s['part']} · {s['n']} | {mmss(t0)}～{mmss(t1)} | {r_:.2f} | {p_:.2f} | {l_:.2f} | "
                 f"{centroid(t0, t1):.0f} | {hf_ratio(t0, t1):.1f} |")
    for part in ("기", "승", "전", "결"):
        ss = [s for s in SECS if s["part"] == part]
        t0, t1 = tb(ss[0]["start"]), tb(ss[-1]["start"] + ss[-1]["bars"])
        r_, p_, l_ = seg_stats(t0, t1)
        L.append(f"| **{part}** | {mmss(t0)}～{mmss(t1)} | {r_:.2f} | {p_:.2f} | {l_:.2f} | {centroid(t0, t1):.0f} | "
                 f"{hf_ratio(t0, t1):.1f} |")
    total_lufs = loudness(x)
    r_, total_pk, _ = seg_stats(0, DUR)
    hf_total = hf_ratio(0, DUR + 1)
    L.append(f"| **전체** | 0:00～5:00 | {r_:.2f} | {total_pk:.2f} | {total_lufs:.2f} | {centroid(0, DUR + 1):.0f} | "
             f"{hf_total:.1f} |\n")
    L.append("(8kHz 이상 에너지 = 그 대역 전력 / 전체 전력, dB)\n")

    L.append("## 15초 창 RMS 곡선\n")
    L.append("```")
    rms15 = []
    for wi in range(20):
        seg = x[:, wi * 15 * SR:(wi + 1) * 15 * SR].astype(np.float64)
        r = db(math.sqrt((seg ** 2).mean()))
        rms15.append(r)
        sec = sec_at_bar(int((wi * 15 + 7.5) // BAR))
        L.append(f"{mmss(wi * 15)}  {sec['part']} {sec['n']:<8s} {r:7.2f}  " + "■" * max(0, int(round(r + 40))))
    L.append("```")
    L.append("(■ 1칸 = 1 dB, 기준 −40 dBFS)\n")

    x64e = x[:, -SR:].astype(np.float64)
    x64b = x[:, :SR].astype(np.float64)
    a = x64e[:, -int(0.05 * SR):]
    b = x64b[:, :int(0.05 * SR)]
    jump = float(np.abs(x64b[:, 0] - x64e[:, -1]).max())
    typ = float(np.abs(np.diff(x64b, axis=1)).max())
    L.append("## 루프 이음매\n")
    L.append(f"- 끝 50ms RMS {db(math.sqrt((a ** 2).mean())):.2f} dBFS / 처음 50ms RMS {db(math.sqrt((b ** 2).mean())):.2f} dBFS")
    L.append(f"- 끝 1초 RMS {db(math.sqrt((x64e ** 2).mean())):.2f} dBFS / 처음 1초 RMS {db(math.sqrt((x64b ** 2).mean())):.2f} dBFS")
    L.append(f"- 경계 샘플 차(마지막→첫 샘플) {jump:.5f}, 처음 1초 안의 인접 샘플 차 최대 {typ:.5f}")
    L.append("- 원형 버퍼 합성: 끝의 벨·에코·리버브 꼬리가 앞머리로 감김. 드론 주파수·진폭 LFO·필터 LFO·바람 LFO는 300초 정수 주기, "
             "섹션 곡선(필터·드론·바람)도 원형으로 정상 상태를 맞춤. 처음과 끝 모두 패드 없는 D 드론 + 먼 벨. MP3 인코더 지연(약 25ms)은 남음\n")

    L.append("## 검사\n")
    ok_len = abs(mp3info["secs"] - DUR) <= 0.5
    ok_sz = mp3info["size"] <= 8 * 1024 * 1024
    ok_pk = total_pk <= CEIL_DB + 0.01
    ok_lu = abs(total_lufs - TARGET_LUFS) <= 0.5
    ok_cbr = mp3info["brs"] == {BITRATE * 1000}
    L.append("| 항목 | 기준 | 값 | 결과 |")
    L.append("|---|---|---|---|")
    L.append(f"| 길이(MP3 프레임) | 300±0.5초 | {mp3info['secs']:.3f}초({mp3info['frames']}프레임) | {'통과' if ok_len else '실패'} |")
    L.append(f"| 비트레이트 | {BITRATE}kbps CBR | 프레임 비트레이트 {sorted(b // 1000 for b in mp3info['brs'])} kbps | {'통과' if ok_cbr else '실패'} |")
    L.append(f"| 크기 | 8MB 이하 | {mp3info['size']:,} bytes ({mp3info['size'] / 1048576:.2f} MB) | {'통과' if ok_sz else '실패'} |")
    L.append(f"| 샘플 피크(PCM) | ≤ {CEIL_DB} dBFS | {total_pk:.2f} dBFS | {'통과' if ok_pk else '실패'} |")
    L.append(f"| 통합 라우드니스 | −16±0.5 LUFS | {total_lufs:.2f} LUFS | {'통과' if ok_lu else '실패'} |")
    L.append(f"| 8kHz 이상 에너지 | 과하지 않게 | 전체 대비 {hf_total:.1f} dB | 참고 |")
    L.append(f"\n- MP3 sha256 `{mp3info['sha']}`")
    L.append(f"- PCM(int16) sha256 `{mp3info['pcm_sha']}`")
    L.append("- 피크·라우드니스는 인코딩 전 PCM 기준\n")
    L.append("![스펙트로그램](spectrogram.png)")
    with open(os.path.join(outdir, "report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 7.5), sharex=True,
                                   gridspec_kw=dict(height_ratios=[3, 1.2], hspace=0.08))
    fm = fr <= 12000
    S = 10 * np.log10(P[:, fm].T + 1e-12)
    vmax = np.percentile(S, 99.5)
    ax1.pcolormesh(tfr[::2], fr[fm], S[:, ::2], shading="auto", cmap="magma", vmin=vmax - 80, vmax=vmax,
                   rasterized=True)
    ax1.set_yscale("symlog", linthresh=200)
    ax1.set_ylim(30, 12000)
    ax1.set_yticks([50, 100, 200, 500, 1000, 2000, 5000, 10000])
    ax1.set_yticklabels(["50", "100", "200", "500", "1k", "2k", "5k", "10k"])
    ax1.set_ylabel("주파수 (Hz)")
    ax1.set_title(f"{TITLE} — 스펙트로그램과 RMS ({KEY_NAME}, {BARS}마디, 300초)", loc="left")
    r1 = [db(math.sqrt((x[:, i:i + SR].astype(np.float64) ** 2).mean())) for i in range(0, N, SR)]
    ax2.plot(np.arange(len(r1)) + 0.5, r1, color="#3b6ea5", lw=1.5, label="1초 RMS")
    ax2.step(np.arange(20) * 15, rms15, where="post", color="#8a8a8a", lw=1.5, label="15초 창 RMS")
    ax2.set_ylabel("RMS (dBFS)")
    ax2.set_xlabel("시간")
    ax2.grid(axis="y", color="#e3e3e3", lw=0.8)
    ax2.set_ylim(min(r1) - 4.5, max(r1) + 1.0)
    ax2.legend(loc="lower center", frameon=False, ncol=2, fontsize=9)
    for s in SECS:
        t0 = tb(s["start"])
        for ax in (ax1, ax2):
            ax.axvline(t0, color="white" if ax is ax1 else "#b0b0b0", lw=0.8, alpha=0.6)
        ax1.text(t0 + 1.5, 9000, f"{s['part']} {s['n']}", color="white", fontsize=8.5, va="top")
    ax2.set_xticks(np.arange(0, 301, 30))
    ax2.set_xticklabels([mmss(v) for v in range(0, 301, 30)])
    ax2.set_xlim(0, DUR)
    for sp in ("top", "right"):
        ax2.spines[sp].set_visible(False)
    fig.savefig(os.path.join(outdir, "spectrogram.png"), dpi=110, bbox_inches="tight")
    plt.close(fig)
    return ok_len and ok_sz and ok_pk and ok_lu and ok_cbr, total_lufs, total_pk


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="'궤도 표류' 스페이스 앰비언트 BGM 합성")
    ap.add_argument("--out", default="bgm-orbit.mp3", help="MP3 출력 경로(json·report·png 는 같은 폴더)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV(선택)")
    args = ap.parse_args(argv)
    t0 = time.time()
    print(f"합성 시작: {BPM} BPM, {BARS}마디, {DUR:.3f}초, seed {SEED}")
    events = build_events()
    print(f"  사건 {len(events):,}개")
    mix, gr = render(events)
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
    info = dict(frames=frames, secs=secs, brs=brs, size=len(mp3), sha=hashlib.sha256(mp3).hexdigest(),
                pcm_sha=hashlib.sha256(pcm.tobytes()).hexdigest())
    del pcm
    ok, lu, pk = analyze(mix, outdir, info, gr, time.time() - t0, events)
    print(f"MP3: {out}  {len(mp3):,} bytes, {secs:.3f}초, LUFS {lu:.2f}, 피크 {pk:.2f} dBFS")
    print(f"  sha256 {info['sha']}")
    print(f"  총 소요 {time.time() - t0:.1f}초, 검사:", "통과" if ok else "실패")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
