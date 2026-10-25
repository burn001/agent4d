#!/usr/bin/env python3
"""'작업실 그루브' 작업 배경음악 결정적 합성기 (활동 단계 2 · 활발).

퓨전 펑크 자체 작곡. 외부 샘플·실존 곡 인용 없이 numpy 로 전부 합성한다.
마스터링·원형 루프·검사·MP3 파이프라인은 music/compose_city.py(← compose.py)를 복사해 재사용했다.

구조: 100 BPM, 4/4, 125마디 = 300초, E minor(E dorian 바탕), 클라이맥스 후반만 F# minor 로 온음 조바꿈.
  기  0:00～0:38  (마디   0～15)  드럼(림·고스트 스네어·어두운 16분 햇) + 핑거 펑크 베이스
  승  0:38～2:29  (마디  16～61)  클라비 16분 커팅(필터 닫힘) → 로즈 EP(9·13) → B 진행·브라스 예고 히트
  전  2:29～3:41  (마디  62～91)  베이스·클라비 유니즌 메인 리프, 신스 브라스 짧은 히트, 78마디 F# minor
  결  3:41～5:00  (마디  92～124) E minor 복귀 → 커팅·EP 빠짐 → 인트로와 같은 드럼·성긴 베이스 → 처음으로

16분 스윙 7%, 타이밍 ±2ms 흔들림. 루프: 모든 꼬리·리버브·딜레이는 300초 원형 버퍼로 앞머리에 감긴다.

사용법:
  python compose_funk.py --out bgm-funk.mp3 [--wav 미리듣기.wav]
  (같은 폴더에 bgm-funk.json, report.md, spectrogram.png 도 만든다)
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
BPM = 100
BEAT = 60.0 / BPM            # 0.6 s
ST = BEAT / 4                # 16분음표 0.15 s
BAR = 4 * BEAT               # 2.4 s
BARS = 125
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
SWING = 0.07                 # 홀수 16분을 16분 길이의 7% 만큼 늦춘다
SECTIONS = [("기", 0), ("승", 16), ("전", 62), ("결", 92)]
TITLE = "작업실 그루브"
MOOD = "퓨전 펑크 — 16분 그루브 드럼·핑거 펑크 베이스·클라비 커팅·로즈 EP·작은 신스 브라스, 기분 좋게 바쁜 작업"
KEY_NAME = "E minor (E dorian, 클라이맥스 후반 F# minor)"
STAGE = 2
ENERGY = 0.72

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "bgm-funk.mp3")

rng = np.random.default_rng(SEED)            # 합성(잡음·위상)용
srng = np.random.default_rng(SEED + 1)       # 악보(고스트·흔들림)용
F32 = np.float32


# ───────────────────────── 기본 유틸 (compose_city.py 에서 복사, 필터는 채널별로) ─────────────────────────

def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def loopf(f: float) -> float:
    """300초에 정수 주기가 되도록 주파수를 맞춘다."""
    return max(1, round(f * DUR)) / DUR


def tb(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


def ts(bar: int, step: float, jit: float = 0.002) -> float:
    """마디·16분 칸 → 초 (스윙 + 작은 흔들림)."""
    s = step + (SWING if int(step) % 2 == 1 and step == int(step) else 0.0)
    return bar * BAR + s * ST + float(srng.normal(0, jit))


def pan_gains(pan: float):
    a = (pan + 1.0) * math.pi / 4.0
    return math.cos(a), math.sin(a)


def new_bus():
    return np.zeros((2, N), dtype=F32)


def add(buf, t0: float, sig, pan: float = 0.0):
    """원형 버퍼에 더한다. sig 가 1차원이면 pan 으로 스테레오화."""
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
        _FREQ = np.fft.rfftfreq(N, 1.0 / SR).astype(F32)
    return _FREQ


def lp_mag(f, fc, order=2):
    return (1.0 / np.sqrt(1.0 + (f / F32(fc)) ** (2 * order))).astype(F32)


def hp_mag(f, fc, order=2):
    r = (f / F32(fc)) ** (2 * order)
    return np.sqrt(r / (1.0 + r)).astype(F32)


def fd_filter(x, mag):
    """원형(루프) 영위상 주파수 영역 필터, 채널별(메모리 절약). x 를 제자리에서 바꾼다."""
    for ch in range(x.shape[0]):
        X = np.fft.rfft(x[ch])
        X *= mag
        x[ch] = np.fft.irfft(X, n=N)
        del X
    return x


def fd_split(x, mag_dark, mag_bright, bright):
    for ch in range(x.shape[0]):
        X = np.fft.rfft(x[ch])
        d = np.fft.irfft(X * mag_dark, n=N)
        b = np.fft.irfft(X * mag_bright, n=N)
        del X
        x[ch] = d * (1 - bright) + b * bright
        del d, b
    return x


def circ_conv(x, ir):
    out = np.zeros((2, N), dtype=F32)
    xs = x if x.ndim == 2 else np.stack([x, x])
    for ch in range(2):
        h = np.zeros(N, dtype=F32)
        h[: ir.shape[1]] = ir[ch]
        out[ch] = np.fft.irfft(np.fft.rfft(xs[ch]) * np.fft.rfft(h), n=N)
    return out


def _t(n):
    return np.arange(n) / SR


def fade_tail(y, sec=0.006):
    k = min(y.shape[-1], max(1, int(sec * SR)))
    y[..., -k:] *= np.linspace(1, 0, k)
    return y


def env_adsr(n, a, d, s, r_len):
    """코사인 어택 → 선형 감쇠 → 지속 → 끝 r_len 동안 코사인 릴리스."""
    ai = max(1, int(a * SR))
    e = np.full(n, s, dtype=np.float64)
    k = min(ai, n)
    e[:k] = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / ai)
    if d > 0 and ai < n:
        di = int(d * SR)
        seg = slice(ai, min(n, ai + di))
        tt = np.arange(seg.stop - seg.start) / max(1, di)
        e[seg] = 1.0 + (s - 1.0) * tt
    ri = int(r_len * SR)
    if 0 < ri < n:
        rel = e[n - ri - 1]
        tt = np.arange(ri) / ri
        e[n - ri:] = rel * (0.5 + 0.5 * np.cos(np.pi * tt))
    return e


# ───────────────────────── 화성 ─────────────────────────
# 화음 = (근음 음이름류, 성질). 성질별 EP 4음(근음 뺀 9·13 보이싱), 클라비 3음, 베이스 도수
EP_IV = {"m9": [3, 7, 10, 14], "13": [4, 10, 14, 21], "maj9": [4, 7, 11, 14]}
CL_IV = {"m9": [7, 10, 14], "13": [4, 10, 21], "maj9": [7, 11, 14]}
BR_IV = {"m9": [3, 7, 10], "13": [4, 10, 14], "maj9": [4, 7, 11]}
DEG = {
    "m9": {"R": 0, "3": 3, "4": 5, "5": 7, "6": 9, "7": 10, "O": 12, "9": 14, "L": -5},
    "13": {"R": 0, "3": 4, "4": 5, "5": 7, "6": 9, "7": 10, "O": 12, "9": 14, "L": -5},
    "maj9": {"R": 0, "3": 4, "4": 5, "5": 7, "6": 9, "7": 11, "O": 12, "9": 14, "L": -5},
}
PCN = {0: "C", 1: "C#", 2: "D", 3: "D#", 4: "E", 5: "F", 6: "F#", 7: "G", 8: "G#", 9: "A", 10: "A#", 11: "B"}
Em9, A13, Cmaj9, D13, Bm9, B13, Am9 = (4, "m9"), (9, "13"), (0, "maj9"), (2, "13"), (11, "m9"), (11, "13"), (9, "m9")
VAMP = [Em9, Em9, A13, A13]
PROG_B = [Cmaj9, Bm9, Am9, D13]
CLIMAX = [Em9, A13, Em9, A13, Cmaj9, D13, Bm9, B13]
KEY_UP = 78                                  # 이 마디부터 91마디까지 온음 위(F# minor)


def chname(c):
    return PCN[c[0] % 12] + c[1]


def tr(c, k):
    return ((c[0] + k) % 12, c[1])


def build_chords():
    tl = []
    for b in range(BARS):
        if 48 <= b < 60:
            segs = [(0, PROG_B[(b - 48) % 4])]
        elif b == 60:
            segs = [(0, Cmaj9), (8, D13)]
        elif b == 61:
            segs = [(0, B13)]
        elif 62 <= b < 78:
            segs = [(0, CLIMAX[(b - 62) % 8])]
        elif 78 <= b < 92:
            segs = [(0, tr(CLIMAX[(b - 78) % 8], 2))]
        elif b == 124:
            segs = [(0, Em9), (8, A13)]
        else:
            segs = [(0, VAMP[b % 4])]
        tl.append(segs)
    return tl


TL = build_chords()


def chord_at(b, step):
    c = TL[b % BARS][0][1]
    for s, ch in TL[b % BARS]:
        if s <= step:
            c = ch
    return c


def nearest(center, pc):
    best = None
    for m in range(int(center) - 6, int(center) + 7):
        if m % 12 == pc and (best is None or abs(m - center) < abs(best - center)):
            best = m
    return best


def voicing(c, ivs, center):
    notes = sorted(nearest(center, (c[0] + iv) % 12) for iv in ivs)
    for i in range(1, len(notes)):
        while notes[i] <= notes[i - 1]:
            notes[i] += 12
    return notes


def bass_root(c, lo=28):
    return lo + (c[0] - lo) % 12


def is_riff_bar(b):
    return 62 <= b < 92 and ((b - 62) % 8 if b < 78 else (b - 78) % 8) < 4


# ───────────────────────── 악보 ─────────────────────────
# 베이스: (16분 칸, 도수, 길이 칸, 세기). 길이 0 = 데드 노트(뮤트 고스트)
BP = {
    "sparse": [(0, "R", 6, 0.9), (10, "R", 2, 0.6), (14, "O", 1, 0.5)],
    "A": [(0, "R", 2, 1.0), (3, "O", 1, 0.7), (5, "R", 0, 0.4), (6, "R", 1, 0.8), (8, "O", 1, 0.8), (9, "7", 1, 0.6),
          (10, "5", 2, 0.75), (13, "R", 1, 0.6), (14, "O", 1, 0.75)],
    "B": [(0, "R", 3, 1.0), (3, "R", 0, 0.4), (4, "O", 1, 0.75), (6, "7", 1, 0.65), (7, "O", 1, 0.7), (10, "R", 2, 0.85),
          (12, "3", 1, 0.6), (13, "4", 1, 0.6), (14, "5", 2, 0.75)],
    "C": [(0, "R", 4, 1.0), (6, "O", 1, 0.7), (7, "7", 1, 0.6), (9, "R", 0, 0.4), (10, "R", 2, 0.8), (14, "5", 1, 0.6),
          (15, "7", 1, 0.6)],
    "D": [(0, "R", 2, 1.0), (2, "O", 1, 0.65), (3, "R", 0, 0.4), (4, "5", 1, 0.7), (6, "R", 1, 0.8), (7, "L", 1, 0.6),
          (8, "R", 2, 0.85), (11, "O", 1, 0.7), (12, "7", 1, 0.6), (14, "5", 1, 0.7), (15, "3", 1, 0.6)],
    # 메인 리프(클라이맥스, 베이스·클라비 유니즌)
    "riff": [(0, "R", 2, 1.0), (2, "O", 1, 0.7), (3, "R", 0, 0.45), (4, "3", 1, 0.8), (6, "4", 1, 0.8), (7, "5", 2, 0.9),
             (10, "7", 1, 0.8), (11, "5", 1, 0.7), (12, "O", 2, 0.9), (14, "7", 1, 0.7), (15, "5", 1, 0.6)],
}
# 클라비 커팅: X 강세 화음, x 약한 화음, g 뮤트 스크래치, . 쉼
CP = {
    "c1": "g.xgX.gxg.xgX.gx",
    "c2": "x.gxg.X.gxg.X.xg",
    "c3": "Xgx.gxX.gxgXgx.x",
    "lite": "g...X..g....X.g.",
}
# EP 컴핑: (칸, 길이 칸, 세기)
EP_EVEN = [(0, 7, 0.8), (7, 3, 0.5), (10, 5, 0.65)]
EP_ODD = [(2, 4, 0.6), (6, 6, 0.7), (14, 6, 0.72)]       # 마지막은 다음 마디 화음 당겨 치기


def drum_mode(b):
    if b < 4 or b >= 121:
        return "intro"
    if b < 16 or 113 <= b < 121:
        return "light"
    if 62 <= b < 92:
        return "climax"
    return "groove"


FILL_BARS = {61: 1.0, 77: 1.0, 91: 0.9, 69: 0.5, 85: 0.5, 47: 0.6, 15: 0.5, 111: 0.5}


def clav_level(b):
    if b < 16 or b >= 112:
        return 0.0
    if b < 20:
        return 0.35 + 0.65 * (b - 16) / 4
    if b >= 108:
        return 1.0 - 0.8 * (b - 107) / 4
    return 1.0


def ep_level(b):
    if b < 24 or b >= 116:
        return 0.0
    if b < 28:
        return 0.4 + 0.6 * (b - 24) / 4
    if b >= 108:
        return 1.0 - 0.85 * (b - 107) / 8
    return 1.0


def gen_bar(b, state):
    ev = []
    mode = drum_mode(b)

    def E(ins, t, v, m=0, d=0.1, pan=0.0):
        ev.append(dict(ins=ins, t=t, v=float(v), m=m, d=float(d), pan=pan, bar=b))

    # ── 드럼 ──
    hat_base = {"intro": 0.6, "light": 0.8, "groove": 1.0, "climax": 1.12}[mode]
    fill = FILL_BARS.get(b, 0.0)
    for s in range(16):
        if fill and s >= 12:
            continue
        acc = 0.55 if s % 4 == 0 else (0.78 if s % 4 == 2 else 0.33)
        v = acc * hat_base * float(srng.uniform(0.85, 1.1))
        opn = mode in ("groove", "climax") and s == 14 and (b % 2 == 1 or mode == "climax")
        if mode == "climax" and s == 6 and b % 4 == 2:
            opn = True
        E("ohat" if opn else "hat", ts(b, s, 0.0025), v * (0.75 if opn else 1.0), pan=0.25)
    kk = {"intro": [(0, 0.9), (10, 0.7)], "light": [(0, 1.0), (6, 0.5), (10, 0.85)],
          "groove": [(0, 1.0), (6 if b % 2 == 0 else 7, 0.5), (10, 0.85)],
          "climax": [(0, 1.0), (3, 0.38), (6 if b % 2 == 0 else 7, 0.55), (10, 0.9)]}[mode]
    if mode in ("groove", "climax") and b % 2 == 1:
        kk = kk + [(13, 0.45)]
    if mode == "intro" and b % 2 == 1:
        kk = kk + [(7, 0.45)]
    for s, v in kk:
        if fill and s >= 12:
            continue
        E("kick", ts(b, s, 0.001), v)
    if mode == "intro":
        for s in (4, 12):
            E("rim", ts(b, s), 0.42, pan=-0.15)
    else:
        bv = {"light": 0.72, "groove": 0.85, "climax": 0.95}[mode]
        for s in (4, 12):
            if fill and s >= 12:
                continue
            E("snare", ts(b, s, 0.0015), bv * float(srng.uniform(0.95, 1.03)), pan=-0.08)
    gp = {"intro": 0.3, "light": 0.35, "groove": 0.45, "climax": 0.55}[mode]
    for s in (2, 7, 9, 11, 14, 15):
        if fill and s >= 12:
            continue
        if srng.random() < gp:
            E("ghost", ts(b, s), float(srng.uniform(0.10, 0.19)), pan=-0.08)
    if fill:
        for s in range(12, 16):
            E("snare", ts(b, s, 0.0015), fill * (0.32 + 0.14 * (s - 12)), pan=-0.08)
            if s in (13, 15):
                E("tom", ts(b, s + 0.5), fill * 0.55, m=50 - 3 * (s - 13), pan=0.3 - 0.2 * (s - 13))
        E("kick", ts(b, 12), 0.6 * fill)

    # ── 베이스 ──
    if b < 4 or b >= 121:
        pat = "sparse"
    elif is_riff_bar(b):
        pat = "riff"
    elif 48 <= b < 62 or 62 <= b < 92:
        pat = "D" if b % 2 else "A"
    else:
        pat = ["A", "B", "A", "C"][b % 4] if b < 113 else ["A", "C", "A", "C"][b % 4]
    bvel = 0.85 if b < 4 or b >= 121 else 1.0
    for s, deg, ln, v in BP[pat]:
        if fill and s >= 14 and pat != "sparse":
            continue
        c = chord_at(b, s)
        m = bass_root(c) + DEG[c[1]][deg]
        d = 0.045 if ln == 0 else ln * ST * 0.9
        E("bass", ts(b, s, 0.0015), v * bvel * float(srng.uniform(0.93, 1.05)) * (0.6 if ln == 0 else 1.0),
          m=m, d=d)
        if pat == "riff" and ln > 0:
            E("clavlead", ts(b, s, 0.0015), v * 0.9, m=m + 36, d=min(d, 0.22), pan=0.18)

    # ── 클라비 커팅 ──
    lv = clav_level(b)
    if lv > 0:
        if is_riff_bar(b):
            cp = "lite"
        elif 62 <= b < 92:
            cp = "c3"
        elif 48 <= b < 62:
            cp = "c2"
        else:
            cp = "c1" if b % 2 == 0 else "c2"
        for s, ch in enumerate(CP[cp]):
            if ch == ".":
                continue
            c = chord_at(b, s)
            vo = voicing(c, CL_IV[c[1]], 66)
            if ch == "g":
                E("scratch", ts(b, s), lv * 0.5 * float(srng.uniform(0.8, 1.1)), m=vo[1], d=0.03, pan=-0.35)
            else:
                v = (0.95 if ch == "X" else 0.62) * lv * float(srng.uniform(0.9, 1.05))
                d = 0.11 if ch == "X" else 0.075
                for i, m in enumerate(vo):
                    E("clav", ts(b, s, 0.0) + 0.003 * i, v, m=m, d=d, pan=-0.35)

    # ── 로즈 EP ──
    lv = ep_level(b)
    if lv > 0:
        pat = EP_EVEN if b % 2 == 0 else EP_ODD
        for s, ln, v in pat:
            if s == 0 and state.get("antic") == b:
                continue
            if s == 14:
                nb = b + 1
                c = chord_at(nb, 0)
                state["antic"] = nb
            else:
                c = chord_at(b, s)
            boost = 1.1 if 62 <= b < 92 else 1.0
            for i, m in enumerate(voicing(c, EP_IV[c[1]], 61)):
                E("ep", ts(b, s, 0.003) + 0.006 * i, v * lv * boost * float(srng.uniform(0.92, 1.05)), m=m,
                  d=ln * ST, pan=-0.2 + 0.13 * i)

    # ── 신스 브라스 짧은 히트(작게) ──
    hits = []
    if 62 <= b < 92:
        if is_riff_bar(b):
            if b % 2 == 1:
                hits = [(12, 0.55, 1), (14, 0.7, 2)]
        else:
            hits = [(0, 0.85, 2), (3, 0.55, 1), (10, 0.75, 2)]
            if b in (69, 77, 85):
                hits = [(0, 0.85, 2), (3, 0.55, 1)]
    elif b in (55, 59):
        hits = [(14, 0.55, 2)]
    elif b == 61:
        hits = [(0, 0.7, 2), (6, 0.5, 1), (10, 0.6, 1)]
    elif b == 92:
        hits = [(0, 0.6, 3)]
    for s, v, ln in hits:
        c = chord_at(b + (1 if s >= 14 else 0), 0) if s >= 14 else chord_at(b, s)
        for i, m in enumerate(voicing(c, BR_IV[c[1]], 67)):
            E("brass", ts(b, s, 0.002) + 0.004 * i, v, m=m, d=ln * ST * 0.85, pan=0.3 - 0.3 * i)

    # ── 상승 잡음(빌드) ──
    if b in (60, 76, 90):
        E("riser", tb(b), 0.6 if b != 90 else 0.4, d=2 * BAR)
    return ev


def build_events():
    state = {}
    ev = []
    for b in range(BARS):
        ev.extend(gen_bar(b, state))
    return ev


# ───────────────────────── 악기 (부드러운 어택, 고역 제한) ─────────────────────────

def ins_kick(v):
    n = int(0.5 * SR)
    t = _t(n)
    f = 48 + 68 * np.exp(-t / 0.032)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.17) * (1 - np.exp(-t / 0.0025))
    y += 0.08 * np.sin(2 * ph) * np.exp(-t / 0.03)
    y = np.tanh(1.3 * y) / np.tanh(1.3)
    return fade_tail(y * v, 0.03).astype(F32)


def ins_snare(v, ghost=False):
    n = int(0.3 * SR)
    t = _t(n)
    body = np.sin(2 * np.pi * (190 + 40 * np.exp(-t / 0.008)) * t) * np.exp(-t / 0.05)
    body += 0.35 * np.sin(2 * np.pi * 330 * t) * np.exp(-t / 0.03)
    nz = rng.standard_normal(n)
    nz = np.convolve(nz, np.ones(4) / 4, mode="same") * np.exp(-t / (0.055 if ghost else 0.11))
    y = (0.6 * body + 0.45 * nz) * (1 - np.exp(-t / (0.0025 if ghost else 0.0018)))
    return fade_tail(y * v, 0.02).astype(F32)


def ins_rim(v):
    n = int(0.12 * SR)
    t = _t(n)
    y = np.sin(2 * np.pi * 1450 * t) * np.exp(-t / 0.009) + 0.5 * np.sin(2 * np.pi * 480 * t) * np.exp(-t / 0.02)
    y *= 1 - np.exp(-t / 0.0009)
    return fade_tail(y * v).astype(F32)


def ins_hat(v, open_=False):
    n = int((0.32 if open_ else 0.09) * SR)
    t = _t(n)
    dec = 0.075 if open_ else 0.014
    y = rng.standard_normal(n) * np.exp(-t / dec) * (1 - np.exp(-t / 0.0012))
    return fade_tail(y * v, 0.01).astype(F32)


def ins_tom(f, v):
    n = int(0.55 * SR)
    t = _t(n)
    ff = f * (0.75 + 0.25 * np.exp(-t / 0.1))
    ph = 2 * np.pi * np.cumsum(ff) / SR
    e = (1 - np.exp(-t / 0.003)) * np.exp(-t / 0.14)
    return fade_tail(np.sin(ph) * e * v).astype(F32)


def ins_bass(f, dur, v):
    """핑거 펑크 베이스: 기음 + 배음(2～6)이 빨리 어두워짐, 손가락 어택 살짝, 짧은 뮤트 릴리스."""
    rel = 0.035
    n = int((dur + rel) * SR)
    t = _t(n)
    y = np.zeros(n)
    for k, a, tau in ((1, 1.0, 9.0), (2, 0.42, 0.35), (3, 0.24, 0.18), (4, 0.12, 0.11), (5, 0.06, 0.08),
                      (6, 0.035, 0.06)):
        if f * k > 2200:
            break
        y += a * np.sin(2 * np.pi * f * k * t + 0.4 * k) * np.exp(-t / tau)
    y = np.tanh(1.4 * y) / np.tanh(1.4)
    env = env_adsr(n, 0.004, 0.25, 0.7, rel)
    return fade_tail(y * env * v).astype(F32)


def ins_clav(f, dur, v):
    """클라비풍: 펄스(듀티 0.3) 가산 합성 + 빨리 닫히는 저역 통과(상한 4.5kHz), 짧은 뮤트."""
    rel = 0.03
    n = int((dur + rel + 0.02) * SR)
    t = _t(n)
    fc = f * 1.6 + (min(4500.0, f * 7.5) - f * 1.6) * np.exp(-t / 0.035)
    y = np.zeros(n)
    for h in range(1, 30):
        fh = f * h
        if fh > 5500:
            break
        a = abs(math.sin(math.pi * h * 0.3)) / h
        y += a * np.sin(2 * np.pi * fh * t) / np.sqrt(1 + (fh / fc) ** 4)
    env = env_adsr(n, 0.002, 0.0, 1.0, rel) * np.exp(-t / 0.18)
    return fade_tail(y * env * v * 1.3).astype(F32)


def ins_scratch(f, dur, v):
    """뮤트 기타 스크래치(칙): 낮은 배음 몇 개 + 걸러진 잡음, 아주 짧게."""
    n = int(0.06 * SR)
    t = _t(n)
    y = np.zeros(n)
    for k in range(1, 6):
        y += np.sin(2 * np.pi * k * f * t + 0.3 * k) / k * np.exp(-t * k / 0.012)
    nz = rng.standard_normal(n)
    nz = np.convolve(nz, np.ones(8) / 8, mode="same")
    y += 0.9 * nz * np.exp(-t / 0.008)
    y *= 1 - np.exp(-t / 0.0015)
    return fade_tail(y * v * 0.6).astype(F32)


def ins_ep(f, dur, v):
    """로즈풍 EP: 배율 1 FM(지수 감소) + 작은 틴 성분, 높은 음일수록 덜 밝게."""
    rel = 0.3
    n = int((dur + rel) * SR)
    t = _t(n)
    ph = 2 * np.pi * f * t
    k = min(1.0, 330.0 / f)
    idx = (1.0 * np.exp(-t / 0.2) + 0.2) * k
    y = np.sin(ph + idx * np.sin(ph)) + 0.04 * np.sin(7 * ph) * np.exp(-t / 0.02) * k
    env = np.exp(-t / 2.0) * env_adsr(n, 0.005, 0.0, 1.0, rel)
    return fade_tail(y * env * v).astype(F32)


def ins_brass(f, dur, v):
    """신스 브라스: 디튠 톱니 3개 가산 합성 + 필터 엔벨로프(살짝 열렸다 닫힘), 부드러운 어택 12ms."""
    rel = 0.07
    n = int((dur + rel) * SR)
    t = _t(n)
    fc = f * (1.4 + 3.2 * np.exp(-t / 0.07) * (1 - np.exp(-t / 0.01)))
    fc = np.minimum(fc, 3500.0)
    y = np.zeros(n)
    for c in (-9.0, 0.0, 8.0):
        fd = f * 2 ** (c / 1200)
        p0 = rng.uniform(0, 6.28)
        for h in range(1, 40):
            fh = fd * h
            if fh > 5000:
                break
            y += np.sin(2 * np.pi * fh * t + p0 * h) / h / np.sqrt(1 + (fh / fc) ** 4)
    env = env_adsr(n, 0.012, 0.06, 0.75, rel)
    return fade_tail(y * env * v / 3).astype(F32)


def ins_riser(v, dur):
    n = int(dur * SR)
    t = _t(n)
    e = (t / dur) ** 2.2 * (1 - np.exp(-(dur - t) / 0.02))
    return fade_tail(rng.standard_normal(n) * e * v).astype(F32)


# ───────────────────────── 이펙트 (compose_city.py 에서 복사) ─────────────────────────

def reverb_ir(length=3.4, rt60_lo=2.6, rt60_hi=1.1):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.018 * SR)
    for ch in range(2):
        noise = rng.standard_normal(n)
        spec = np.fft.rfft(noise)
        fr = np.fft.rfftfreq(n, 1 / SR)
        lo = np.fft.irfft(spec * lp_mag(fr, 1800, 1), n=n)
        hi = np.fft.irfft(spec * hp_mag(fr, 1800, 1), n=n)
        tail = lo * np.exp(-6.91 * t / rt60_lo) + hi * np.exp(-6.91 * t / rt60_hi)
        tail *= 1 - np.exp(-t / 0.03)
        ir[ch, pre:] = tail[: n - pre]
        for k, ms in enumerate((11, 19, 29, 37, 53, 71, 89)):
            idx = int((ms + (3 if ch else 0)) * SR / 1000)
            ir[ch, idx] += 0.5 * (0.8 ** k) * (1 if (k + ch) % 2 else -1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


def echo_ir(delay_beats=0.75, fb=0.32, taps=7):
    d = delay_beats * BEAT
    n = int(d * (taps + 1) * SR) + 16
    ir = np.zeros((2, n))
    for k in range(1, taps + 1):
        i = int(k * d * SR)
        ir[(k + 1) % 2, i] = fb ** (k - 1) * 0.6
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * lp_mag(fr, 3000, 1), n=n, axis=1)
    return ir.astype(F32)


def sidechain(trig, depth=0.25):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    shape = (1 - np.exp(-t / 0.008)) * np.exp(-t / 0.16)
    h = np.zeros(N, dtype=F32)
    h[:n] = shape
    env = np.fft.irfft(np.fft.rfft(trig) * np.fft.rfft(h), n=N)
    return (1 - depth * np.clip(env / 0.26, 0, 1)).astype(F32)


# ───────────────────────── 측정·마스터링 (compose_city.py 에서 복사) ─────────────────────────

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
    """통합 라우드니스(LUFS 근사, 게이트 포함). x:(2,n), n 은 임의."""
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
    y = (x * g[None, :]).astype(F32)
    return y, float(20 * np.log10(g.min()))


# ───────────────────────── 조립 ─────────────────────────

_SYN = {}


def cached(ins, m, d, fn):
    """같은 (악기, 음, 길이) 는 단위 세기로 한 번만 합성해 재사용(세기는 선형으로 곱한다)."""
    k = (ins, m, round(d, 4))
    if k not in _SYN:
        _SYN[k] = fn(mtof(m), d, 1.0)
    return _SYN[k]


def render_bus(events, names, fn):
    bus = new_bus()
    for e in events:
        if e["ins"] in names:
            add(bus, e["t"], fn(e), e["pan"])
    return bus


def sec_rms(x):
    bounds = [s for _, s in SECTIONS] + [BARS]
    row = []
    for k in range(len(SECTIONS)):
        seg = x[:, int(tb(bounds[k]) * SR):int(tb(bounds[k + 1]) * SR)].astype(np.float64)
        row.append(20 * math.log10(max(math.sqrt(float((seg ** 2).mean())), 1e-9)))
    return row


def render(log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()
    events = build_events()
    st(f"events {len(events)}")
    stems = {}
    mix = new_bus()
    rev_send = new_bus()
    echo_send = new_bus()

    def put(name, x, rev=0.0, echo=0.0):
        stems[name] = sec_rms(x)
        mix[...] += x
        if rev:
            rev_send[...] += F32(rev) * x
        if echo:
            echo_send[...] += F32(echo) * x

    # 킥 + 사이드체인 트리거
    kb = new_bus()
    trig = np.zeros(N, dtype=F32)
    for e in events:
        if e["ins"] == "kick":
            add(kb, e["t"], ins_kick(e["v"]))
            trig[int(round(e["t"] * SR)) % N] += e["v"]
    duck = sidechain(trig, 0.22)
    del trig
    fd_filter(kb, hp_mag(f, 30, 2) * lp_mag(f, 3200, 2))
    kb *= F32(0.68)
    put("kick", kb, rev=0.03)
    del kb
    st("kick")

    sn = new_bus()
    for e in events:
        if e["ins"] == "snare":
            add(sn, e["t"], ins_snare(e["v"]), e["pan"])
        elif e["ins"] == "ghost":
            add(sn, e["t"], ins_snare(e["v"], ghost=True), e["pan"])
        elif e["ins"] == "rim":
            add(sn, e["t"], ins_rim(e["v"]), e["pan"])
        elif e["ins"] == "tom":
            add(sn, e["t"], ins_tom(mtof(e["m"]), e["v"]), e["pan"])
    fd_filter(sn, hp_mag(f, 110, 2) * lp_mag(f, 5000, 2))
    sn *= F32(1.75)
    put("snare·ghost·rim·tom", sn, rev=0.16)
    del sn
    st("snare")

    hh = new_bus()
    for e in events:
        if e["ins"] in ("hat", "ohat"):
            add(hh, e["t"], ins_hat(e["v"], e["ins"] == "ohat"), e["pan"])
    # 타이트·어두운 햇: 2.6～6.2kHz 대역에 가두고 8kHz 위는 3차로 깎는다
    fd_filter(hh, hp_mag(f, 2600, 2) * lp_mag(f, 6200, 3))
    hh *= F32(0.68)
    put("hihat", hh, rev=0.08)
    del hh
    st("hihat")

    bs = render_bus(events, {"bass"}, lambda e: cached("bass", e["m"], e["d"], ins_bass) * F32(e["v"]))
    fd_filter(bs, hp_mag(f, 32, 2) * lp_mag(f, 1500, 2))
    bs *= (0.8 + 0.2 * duck)[None, :]
    bs *= F32(0.5)
    put("bass", bs, rev=0.02)
    del bs
    st("bass")

    bright = automation([(0, 0.15), (16, 0.2), (32, 0.4), (48, 0.5), (62, 0.8), (78, 1.0), (92, 0.6), (108, 0.35),
                         (125, 0.15)])
    CF = {"clav": (ins_clav, 1.0), "clavlead": (ins_clav, 0.95), "scratch": (ins_scratch, 1.0)}
    cl = render_bus(events, set(CF), lambda e: cached(e["ins"], e["m"], e["d"], CF[e["ins"]][0])
                    * F32(e["v"] * CF[e["ins"]][1]))
    hp = hp_mag(f, 220, 1)
    fd_split(cl, hp * lp_mag(f, 1900, 2), hp * lp_mag(f, 4000, 2), bright)
    cl *= F32(0.3)
    put("clav·커팅·리프", cl, rev=0.14, echo=0.08)
    del cl
    st("clav")

    ep = render_bus(events, {"ep"}, lambda e: cached("ep", e["m"], e["d"], ins_ep) * F32(e["v"]))
    fd_filter(ep, hp_mag(f, 90, 1) * lp_mag(f, 3600, 2))
    tt = np.arange(N, dtype=np.float64) / SR
    lfo = np.sin(2 * np.pi * loopf(BPM / 60 / 2) * tt).astype(F32)       # 2박 1주기 오토팬 트레몰로
    del tt
    ep[0] *= 1 + 0.22 * lfo
    ep[1] *= 1 - 0.22 * lfo
    del lfo
    ep *= (0.85 + 0.15 * duck)[None, :]
    ep *= F32(0.21)
    put("rhodes EP", ep, rev=0.3, echo=0.05)
    del ep
    st("ep")

    br = render_bus(events, {"brass"}, lambda e: cached("brass", e["m"], e["d"], ins_brass) * F32(e["v"]))
    fd_filter(br, hp_mag(f, 200, 1) * lp_mag(f, 3000, 2))
    br *= F32(0.26)
    put("synth brass", br, rev=0.35, echo=0.15)
    del br
    st("brass")

    rs = render_bus(events, {"riser"}, lambda e: ins_riser(e["v"], e["d"]))
    fd_filter(rs, hp_mag(f, 500, 2) * lp_mag(f, 2600, 2))
    rs *= F32(0.12)
    put("riser", rs, rev=0.4)
    del rs, duck
    st("riser")

    echo = circ_conv(echo_send.mean(axis=0), echo_ir())
    del echo_send
    mix += F32(0.35) * echo
    rev_send += F32(0.3) * echo
    del echo
    st("echo")
    wet = circ_conv(rev_send, reverb_ir(2.4, 1.7, 0.7))
    del rev_send
    fd_filter(wet, hp_mag(f, 160, 1) * lp_mag(f, 6000, 1))
    mix += F32(0.24) * wet
    del wet
    st("reverb")

    # 초저역 정리 + 10kHz 위를 완만히 눌러 날카로움 방지
    fd_filter(mix, hp_mag(f, 28, 2) * lp_mag(f, 10000, 1))

    lufs0 = loudness(mix)
    gain = F32(10 ** ((TARGET_LUFS - lufs0) / 20))
    mix *= gain
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
    for _ in range(2):
        l1 = loudness(mix)
        if abs(l1 - TARGET_LUFS) < 0.2:
            break
        g2 = F32(10 ** ((TARGET_LUFS - l1) / 20))
        mix *= g2
        gain *= g2
        mix, gr2 = limiter(mix, ceil)
        gr = min(gr, gr2)
    pk = float(np.abs(mix).max())
    if pk > ceil:
        mix *= F32(ceil / pk)
    st(f"master (limiter max GR {gr:.2f} dB)")
    gdb = 20 * math.log10(float(gain))
    stem_rms = {k: [v + gdb for v in row] for k, row in stems.items()}
    return mix, events, stem_rms, gr


def to_int16(x):
    d = (rng.random(x.shape) - rng.random(x.shape))        # TPDF 디더
    y = np.round(x.astype(np.float64) * 32767.0 + d)
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


def mp3_frames(data: bytes):
    """MPEG-1 Layer III 프레임 헤더를 따라가며 (프레임 수, 초) 계산."""
    br_tab = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    sr_tab = [44100, 48000, 32000, 0]
    i, frames, sr = 0, 0, SR
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
        flen = 144 * br // sr + pad
        frames += 1
        i += flen
    return frames, frames * 1152 / sr


# ───────────────────────── 분석·보고 ─────────────────────────

def db(v):
    return 20 * math.log10(max(v, 1e-12))


def mmss(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def true_peak(x):
    """4배 오버샘플(FFT 보간, 청크) 근사 트루 피크."""
    best = 0.0
    blk, pad = 1 << 18, 512
    for ch in range(2):
        xp = np.concatenate([x[ch, -pad:], x[ch], x[ch, :blk + pad]]).astype(np.float32)
        for i0 in range(0, N, blk):
            seg = xp[i0:i0 + blk + 2 * pad]
            up = np.fft.irfft(np.fft.rfft(seg), n=len(seg) * 4) * 4
            best = max(best, float(np.abs(up[4 * pad:-4 * pad]).max()))
    return best


def centroid(seg):
    mono = seg.mean(axis=0).astype(np.float64)
    nfft = 8192
    nfr = len(mono) // nfft
    frames = mono[: nfr * nfft].reshape(nfr, nfft) * np.hanning(nfft)[None, :]
    P = (np.abs(np.fft.rfft(frames, axis=1)) ** 2).sum(axis=0)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    return float((P * fr).sum() / P.sum())



SUBS = [
    ("인트로", 0, 4, "기", "드럼(림 2·4박, 고스트 스네어, 어두운 16분 햇) + 성긴 핑거 베이스, Em9–A13 바탕"),
    ("그루브 도입", 4, 16, "기", "스네어 백비트, 베이스 16분 싱코페이션·옥타브(패턴 A·B·C 순환)"),
    ("커팅 진입", 16, 24, "승", "클라비/뮤트 기타풍 16분 커팅(필터 닫힘, 점점 크게), 오픈 햇"),
    ("EP 진입", 24, 48, "승", "로즈 EP Em9·A13 컴핑(당겨 치기), 커팅 필터 서서히 열림"),
    ("B 진행", 48, 62, "승", "Cmaj9–Bm9–Am9–D13, 브라스 예고 히트, 60～61마디 상승 잡음·필인 → B13"),
    ("메인 리프", 62, 78, "전", "베이스·클라비 유니즌 리프(Em9·A13 4마디) ↔ Cmaj9–D13–Bm9–B13 브라스 히트"),
    ("키 체인지", 78, 92, "전", "온음 위 F# minor 로 리프 반복, 필터 최대 → E13 에서 Em9 로 복귀"),
    ("정리", 92, 112, "결", "Em9–A13 그루브, 브라스 빠짐, 커팅·EP 점점 작게"),
    ("빠짐", 112, 121, "결", "커팅 빠짐, EP 사라짐, 드럼 가볍게 + 베이스"),
    ("끝", 121, 125, "결", "인트로와 같은 드럼·성긴 베이스, A13 → 처음 Em9 로 이어짐(루프)"),
]


def hf_ratio(seg, fcut=8000.0):
    mono = seg.mean(axis=0).astype(np.float64)
    nfft = 8192
    nfr = len(mono) // nfft
    frames = mono[: nfr * nfft].reshape(nfr, nfft) * np.hanning(nfft)[None, :]
    P = (np.abs(np.fft.rfft(frames, axis=1)) ** 2).sum(axis=0)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    return 10 * math.log10(max(P[fr >= fcut].sum(), 1e-30) / P.sum())


def analyze(x, log=print):
    res = {"sections": [], "sub": [], "windows": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    log("\n구간별 에너지")
    log("  구간  시간          RMS(dBFS)  피크(dBFS)  LUFS(근사)  중심(Hz)  8k+ (dB)")
    for k, (name, b0) in enumerate(SECTIONS):
        t0, t1 = tb(b0), tb(bounds[k + 1])
        seg = x[:, int(t0 * SR):int(t1 * SR)].astype(np.float64)
        row = dict(name=name, t0=t0, t1=t1, bars=(b0, bounds[k + 1] - 1),
                   rms=db(math.sqrt(float((seg ** 2).mean()))), peak=db(float(np.abs(seg).max())),
                   lufs=loudness(seg), cent=centroid(seg), hf=hf_ratio(seg))
        res["sections"].append(row)
        log(f"  {name}    {mmss(t0)}～{mmss(t1)}    {row['rms']:7.2f}   {row['peak']:8.2f}   {row['lufs']:8.2f}"
            f"   {row['cent']:7.0f}   {row['hf']:6.1f}")
    for name, b0, b1, big, _ in SUBS:
        seg = x[:, int(tb(b0) * SR):int(tb(b1) * SR)]
        res["sub"].append(dict(name=name, b0=b0, b1=b1 - 1, t0=tb(b0), t1=tb(b1),
                               rms=db(math.sqrt(float((seg.astype(np.float64) ** 2).mean()))),
                               lufs=loudness(seg), cent=centroid(seg)))
    res["total_rms"] = db(math.sqrt(float((x.astype(np.float64) ** 2).mean())))
    res["peak"] = db(float(np.abs(x).max()))
    res["lufs"] = loudness(x)
    res["true_peak"] = db(true_peak(x))
    res["cent"] = centroid(x)
    res["hf"] = hf_ratio(x)
    log(f"  전체  0:00～5:00    {res['total_rms']:7.2f}   {res['peak']:8.2f}   {res['lufs']:8.2f}   {res['cent']:7.0f}"
        f"   {res['hf']:6.1f}   (트루피크 근사 {res['true_peak']:.2f} dBTP)")
    log("\n15초 창 RMS 곡선 (dBFS, ■ 1칸 = 1 dB, 기준 -40)")
    for w in range(20):
        seg = x[:, w * 15 * SR:(w + 1) * 15 * SR].astype(np.float64)
        r = db(math.sqrt(float((seg ** 2).mean())))
        tmid = w * 15 + 7.5
        sec = [n for n, b in SECTIONS if tb(b) <= tmid][-1]
        res["windows"].append((w * 15, sec, r))
        log(f"  {mmss(w * 15)} {sec} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    jump = float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max())
    typ = float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max())
    a1 = x[:, -SR:].astype(np.float64)
    b1 = x[:, :SR].astype(np.float64)
    res["seam"] = dict(end50=db(math.sqrt((a ** 2).mean())), start50=db(math.sqrt((b ** 2).mean())),
                       end1s=db(math.sqrt((a1 ** 2).mean())), start1s=db(math.sqrt((b1 ** 2).mean())),
                       jump=jump, typ=typ, cent_end=centroid(x[:, -10 * SR:]), cent_start=centroid(x[:, :10 * SR]),
                       lufs_end=loudness(x[:, -int(4 * BAR * SR):]), lufs_start=loudness(x[:, :int(4 * BAR * SR)]))
    s = res["seam"]
    log(f"\n루프 이음매: 끝 50ms RMS {s['end50']:.2f} dBFS, 처음 50ms RMS {s['start50']:.2f} dBFS, "
        f"경계 샘플 차 {jump:.5f} (전형적 인접 샘플 차 최대 {typ:.5f}), 끝·처음 4마디 LUFS "
        f"{s['lufs_end']:.2f} / {s['lufs_start']:.2f}")
    return res


def spectrogram_png(x, path, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    mono = x.mean(axis=0).astype(np.float64)
    nfft, hop = 4096, 2048
    nfr = (len(mono) - nfft) // hop + 1
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfr)[:, None]
    win = np.hanning(nfft)
    S = np.empty((nfr, nfft // 2 + 1), dtype=np.float32)
    for i in range(0, nfr, 512):
        S[i:i + 512] = np.abs(np.fft.rfft(mono[idx[i:i + 512]] * win, axis=1)).astype(np.float32)
    fr_lin = np.fft.rfftfreq(nfft, 1 / SR)
    fr = np.geomspace(30, 16000, 320)              # 로그 간격 320칸으로 줄여 그린다
    edges = np.searchsorted(fr_lin, np.sqrt(fr[:-1] * fr[1:]))
    edges = np.concatenate([[np.searchsorted(fr_lin, 30)], edges, [np.searchsorted(fr_lin, 16000)]])
    cs = np.concatenate([np.zeros((S.shape[0], 1), np.float32), np.cumsum(S ** 2, axis=1)], axis=1)
    lo, hi = edges[:-1], np.maximum(edges[1:], edges[:-1] + 1)
    S = np.sqrt((cs[:, hi] - cs[:, lo]) / (hi - lo))
    Sdb = 20 * np.log10(S.T + 1e-7)
    tt = (np.arange(nfr) * hop + nfft / 2) / SR
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 7.5), sharex=True, gridspec_kw={"height_ratios": [3, 1.2]})
    vmax = float(Sdb.max())
    ax1.pcolormesh(tt[::2], fr, Sdb[:, ::2], shading="auto", cmap="magma", vmin=vmax - 80, vmax=vmax)
    ax1.set_yscale("log")
    ax1.set_ylim(30, 16000)
    ax1.set_ylabel("주파수 (Hz)")
    ax1.set_title(f"{TITLE} — 스펙트로그램 (모노 합, {BPM} BPM, 300초)")
    win_s = 1.0
    nw = int(DUR / win_s)
    rms = [db(math.sqrt(float((x[:, int(i * win_s * SR):int((i + 1) * win_s * SR)].astype(np.float64) ** 2).mean())))
           for i in range(nw)]
    ax2.plot(np.arange(nw) * win_s + win_s / 2, rms, color="#2a6fdb", lw=1.2, label="1초 RMS")
    w15 = res["windows"]
    ax2.step([w[0] for w in w15] + [300], [w[2] for w in w15] + [w15[-1][2]], where="post", color="#e07b00", lw=1.4,
             label="15초 RMS")
    ax2.set_ylabel("RMS (dBFS)")
    ax2.set_xlabel("시간 (초)")
    ax2.set_ylim(min(rms) - 3, max(rms) + 3)
    ax2.grid(alpha=0.3)
    ax2.legend(loc="lower center", fontsize=8, ncol=2)
    for name, b in SECTIONS:
        for ax in (ax1, ax2):
            ax.axvline(tb(b), color="white" if ax is ax1 else "#555", lw=0.9, ls="--", alpha=0.8)
        ax1.text(tb(b) + 2, 20000 * 0.7, name, color="white", fontsize=12, va="top")
    ax1.set_xlim(0, DUR)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)



def write_report(path, res, stem_rms, mp3_info, gr, elapsed):
    L = []
    L.append(f"# {TITLE} — 작업 배경음악 합성 보고\n")
    L.append(f"- 생성: `compose_funk.py` (seed {SEED}, numpy {np.__version__}), 실행 시간 {elapsed:.0f}초")
    L.append(f"- 형식: {SR} Hz 스테레오, {BITRATE} kbps CBR MP3, {BPM} BPM 4/4, {BARS}마디 = {DUR:.1f}초, {KEY_NAME}")
    L.append(f"- 용도: 활동 단계 {STAGE}(활발), energy {ENERGY}. 자체 작곡(외부 샘플·실존 곡 인용 없음), 16분 스윙 {SWING * 100:.0f}%\n")
    L.append("## 곡 구조\n")
    L.append("| 큰 구간 | 세부 구간 | 시간 | 마디 | 화음 | 편성 |")
    L.append("|---|---|---|---|---|---|")
    for name, b0, b1, big, desc in SUBS:
        seen = []
        for b in range(b0, b1):
            for _, c in TL[b]:
                n_ = chname(c)
                if not seen or seen[-1] != n_:
                    seen.append(n_)
        prog = "–".join(seen[:8]) + ("…" if len(seen) > 8 else "")
        L.append(f"| {big} | {name} | {mmss(tb(b0))}～{mmss(tb(b1))} | {b0}～{b1 - 1} | {prog} | {desc} |")
    L.append("")
    L.append("## 구간별 RMS·LUFS·스펙트럼 중심\n")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) | 8kHz 이상 에너지 (dB, 전체 대비) |")
    L.append("|---|---|---|---|---|---|---|")
    for r in res["sections"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['peak']:.2f} | {r['lufs']:.2f} "
                 f"| {r['cent']:.0f} | {r['hf']:.1f} |")
    L.append(f"| 전체 | 0:00～5:00 | {res['total_rms']:.2f} | {res['peak']:.2f} | {res['lufs']:.2f} | {res['cent']:.0f} "
             f"| {res['hf']:.1f} |")
    L.append("")
    L.append("세부 구간\n")
    L.append("| 세부 구간 | 시간 | RMS (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) |")
    L.append("|---|---|---|---|---|")
    for r in res["sub"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['lufs']:.2f} | {r['cent']:.0f} |")
    L.append("")
    L.append("악기 갈래별 RMS (마스터 이득 적용, 리버브 제외, dBFS)\n")
    L.append("| 갈래 | " + " | ".join(n for n, _ in SECTIONS) + " |")
    L.append("|---|" + "---|" * len(SECTIONS))
    for k, row in stem_rms.items():
        L.append(f"| {k} | " + " | ".join(("—" if v < -90 else f"{v:.1f}") for v in row) + " |")
    L.append("")
    L.append("## 15초 창 RMS 곡선\n")
    L.append("```")
    for t0, sec, r in res["windows"]:
        L.append(f"{mmss(t0)} {sec} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    L.append("```")
    L.append("(■ 1칸 = 1 dB, 기준 −40 dBFS)\n")
    s = res["seam"]
    L.append("## 루프 이음매\n")
    L.append("| 항목 | 값 |")
    L.append("|---|---|")
    L.append(f"| 끝 50ms RMS / 처음 50ms RMS | {s['end50']:.2f} / {s['start50']:.2f} dBFS |")
    L.append(f"| 끝 1초 RMS / 처음 1초 RMS | {s['end1s']:.2f} / {s['start1s']:.2f} dBFS |")
    L.append(f"| 끝 4마디 LUFS / 처음 4마디 LUFS | {s['lufs_end']:.2f} / {s['lufs_start']:.2f} |")
    L.append(f"| 경계 샘플 차(끝→처음) | {s['jump']:.5f} (처음 1초 인접 샘플 차 최대 {s['typ']:.5f}) |")
    L.append(f"| 스펙트럼 중심 끝 10초 / 처음 10초 | {s['cent_end']:.0f} / {s['cent_start']:.0f} Hz |")
    L.append("| 방식 | 300초 원형 버퍼: 끝을 넘는 음 꼬리·리버브·딜레이가 앞머리로 감김. 끝 4마디와 처음 4마디가 같은 편성(림·고스트·성긴 베이스), "
             "마지막 A13 → 첫 Em9, EP 트레몰로 LFO 는 300초 정수 주기, 밝기 자동화 양끝 같은 값(0.15) |")
    L.append("| 한계 | MP3 인코더 지연·패딩(약 25～50ms)은 남으므로 `<audio loop>` 는 완전 무간격이 아님 |")
    L.append("")
    L.append("## 검사\n")
    L.append("| 항목 | 기준 | 결과 | 판정 |")
    L.append("|---|---|---|---|")
    for name, crit, val, ok in mp3_info["checks"]:
        L.append(f"| {name} | {crit} | {val} | {'통과' if ok else '실패'} |")
    L.append(f"\n리미터 최대 이득 감소 {gr:.2f} dB.\n")
    L.append("## 파일\n")
    L.append("| 파일 | 크기 | SHA-256 |")
    L.append("|---|---|---|")
    for fn, size, h in mp3_info["files"]:
        L.append(f"| `{fn}` | {size:,} bytes | `{h}` |")
    L.append(f"\nPCM(16bit) SHA-256 `{mp3_info['pcm_sha']}`. 같은 환경에서 다시 실행하면 같은 해시가 나옵니다.")
    if mp3_info.get("repro"):
        L.append(f"\n재현성: {mp3_info['repro']}")
    L.append("\n![스펙트로그램](spectrogram.png)\n")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=f"'{TITLE}' 작업 배경음악 합성")
    ap.add_argument("--out", default=DEFAULT_OUT, help="MP3 출력 경로 (json·report·png 는 같은 폴더)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV 도 저장(선택)")
    ap.add_argument("--repro", default=None, help="재현성 확인 문구를 report.md 에 덧붙임(선택)")
    args = ap.parse_args(argv)

    t0 = time.time()
    print(f"합성 시작: {BPM} BPM, {BARS}마디, {DUR:.0f}초, seed {SEED}")
    mix, events, stem_rms, gr = render()
    ta = time.time()
    res = analyze(mix)
    print(f"  분석 {time.time() - ta:.0f}초")
    pcm = to_int16(mix)
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
        print(f"WAV: {args.wav}")
    mp3 = encode_mp3(pcm)
    with open(out, "wb") as fh:
        fh.write(mp3)
    stem = os.path.splitext(os.path.basename(out))[0]
    jpath = os.path.join(od, stem + ".json")
    meta = {"duration": int(round(DUR)), "bpm": BPM, "key": KEY_NAME,
            "sections": [{"name": n, "start": int(round(tb(b)))} for n, b in SECTIONS], "seed": SEED,
            "title": TITLE, "mood": MOOD, "stage": STAGE, "energy": ENERGY}
    with open(jpath, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    png = os.path.join(od, "spectrogram.png")
    ta = time.time()
    spectrogram_png(mix, png, res)
    print(f"  스펙트로그램 {time.time() - ta:.0f}초")
    frames, secs = mp3_frames(mp3)
    pcm_sha = hashlib.sha256(pcm.tobytes()).hexdigest()
    mp3_sha = hashlib.sha256(mp3).hexdigest()
    print(f"\nMP3: {out}")
    print(f"  크기 {len(mp3):,} bytes ({len(mp3)/1048576:.2f} MB), 프레임 {frames}, 길이 {secs:.3f}초, {BITRATE}kbps CBR")
    print(f"  PCM sha256 {pcm_sha[:16]}…  MP3 sha256 {mp3_sha}")
    checks = [
        ("길이", "300±0.5초", f"{secs:.3f}초 ({frames} 프레임)", abs(secs - DUR) <= 0.5),
        ("크기", "8 MB 이하", f"{len(mp3)/1048576:.2f} MB", len(mp3) <= 8 * 1024 * 1024),
        ("샘플 피크", "≤ −1.5 dBFS", f"{res['peak']:.2f} dBFS", res["peak"] <= -1.5 + 1e-3),
        ("트루 피크(4× 근사)", "참고", f"{res['true_peak']:.2f} dBTP", True),
        ("통합 라우드니스", "−16±0.5 LUFS", f"{res['lufs']:.2f} LUFS", abs(res["lufs"] - TARGET_LUFS) <= 0.5),
        ("8kHz 이상 에너지", "전체 대비 ≤ −25 dB", f"{res['hf']:.1f} dB", res["hf"] <= -25),
        ("PCM 길이", "정확히 300초", f"{pcm.shape[1]} 샘플 = {pcm.shape[1]/SR:.3f}초", pcm.shape[1] == N),
    ]
    ok = all(c[3] for c in checks)
    elapsed = time.time() - t0
    files = [(os.path.basename(out), len(mp3), mp3_sha), (os.path.basename(jpath), os.path.getsize(jpath), sha(jpath)),
             ("spectrogram.png", os.path.getsize(png), sha(png)),
             ("compose_funk.py", os.path.getsize(os.path.abspath(__file__)), sha(os.path.abspath(__file__)))]
    write_report(os.path.join(od, "report.md"), res, stem_rms,
                 {"checks": checks, "files": files, "pcm_sha": pcm_sha, "repro": args.repro}, gr, elapsed)
    for c in checks:
        print(f"  {c[0]}: {c[2]} ({c[1]}) {'통과' if c[3] else '실패'}")
    print(f"  검사: {'통과' if ok else '실패'}  (실행 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
