#!/usr/bin/env python3
"""칠홉/로파이 재즈 작업 배경음악 결정적 합성기.

외부 샘플 없이 numpy 만으로 5분(300초) 곡을 합성해 MP3(44.1kHz 스테레오 128kbps CBR)와
같은 이름의 .json, report.md, spectrogram.png 를 만든다.

마스터링·원형 버퍼 루프·측정 코드는 music/compose.py 를 복사해 재사용했다.

구조: 80 BPM, 4/4, 100마디(마디 3초) = 300초, F major(재즈 7·9·11·13 화성), 16분 스윙 62%.
  인트로      0:00～0:36 (마디  0～11)  바이닐, 어두운 로즈 화음, 4마디부터 베이스, 8마디부터 하이햇
  그루브      0:36～1:48 (마디 12～35)  붐뱁 비트 진입(둥근 킥·레이백 스네어·고스트), 뮤트 기타 모티프
  전개        1:48～3:00 (마디 36～59)  화성 전환 B, 비브라폰 모티프, 기타 처킹, 패드
  클라이맥스  3:00～3:48 (마디 60～75)  비브라폰+기타 옥타브 겹침, 변형 모티프(최고음 A5), 필터 최대
  브레이크다운 3:48～4:24 (마디 76～87) 필터 내려감, 림·하이햇만, 비브라폰 조각, 84마디부터 다시 쌓임
  아웃트로    4:24～5:00 (마디 88～99)  비트 약하게→빠짐, 기타 모티프 회상, 로즈만 남아 C13→Fmaj9 로 처음과 이어짐

사용법:
  python compose_chillhop.py --out bgm-chillhop.mp3 [--wav 미리듣기.wav]
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

SEED = 7780
SR = 44100
BPM = 80
BEAT = 60.0 / BPM            # 0.75 s
BAR = 4 * BEAT               # 3.0 s
BARS = 100
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -1.5               # 샘플 피크 상한(MP3 오버슈트 여유, 요구 -1 dBFS 이하)
BITRATE = 128
SW16 = 0.06                  # 16분 홀수 칸 지연(박 단위) → 스윙 비 (0.25+0.06)/0.5 = 62%
LAYBACK = 0.024              # 스네어 레이백(초)
TITLE = "Slow Pour (칠홉 작업 BGM)"
MOOD = "chillhop / lo-fi jazz, boom-bap swing, warm, unobtrusive"
SECTIONS = [("인트로", 0), ("그루브", 12), ("전개", 36), ("클라이맥스", 60), ("브레이크다운", 76), ("아웃트로", 88)]
GIST = {"인트로": "기", "그루브": "승", "전개": "승", "클라이맥스": "전", "브레이크다운": "결", "아웃트로": "결"}
SECTION_DESC = {
    "인트로": "바이닐 질감, 어두운 로즈 화음(롤 스트럼), 4마디 베이스 온음표, 8마디 하이햇·셰이커, 11마디 스네어 픽업",
    "그루브": "붐뱁 비트 진입(둥근 킥·레이백 스네어·고스트), 필터 열림, 20마디부터 뮤트 기타 모티프 M1·M2",
    "전개": "화성 B로 전환, 기타 처킹·패드, 44마디 비브라폰 B 모티프, 52마디 기타 옥타브 아래 겹침",
    "클라이맥스": "A 화성 복귀, 비브라폰+기타 겹침, 변형 모티프 M1'·M2'(최고 A5), 오픈 하이햇·고스트 증가",
    "브레이크다운": "로파이 필터 내려감, 킥·스네어 빠지고 림·하이햇만, 비브라폰 조각, 84마디부터 반박 킥으로 재상승",
    "아웃트로": "비트 약하게 돌아왔다 94마디 빠짐, 기타 M1·M2 회상, 96마디부터 로즈만 남아 C13→(처음)Fmaj9",
}

HERE = os.path.dirname(os.path.abspath(__file__))

rng = np.random.default_rng(SEED)
F32 = np.float32


# ───────────────────────── 기본 유틸 (compose.py 재사용) ─────────────────────────

def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def loopf(f: float) -> float:
    """300초 동안 정수 주기가 되도록 주파수를 맞춘다(루프 이음매 위상 연속)."""
    return max(1, round(f * DUR)) / DUR


def tb(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


def swing_beat(beat: float) -> float:
    """16분 그리드의 홀수 칸(x.25, x.75)을 늦춘다."""
    q = beat * 4
    if abs(q - round(q)) < 1e-6 and int(round(q)) % 2 == 1:
        return beat + SW16
    return beat


def ts(bar: int, beat: float, jitter: float = 0.004) -> float:
    return tb(bar, swing_beat(beat)) + float(rng.uniform(-jitter, jitter))


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
    """[(bar, value), ...] 를 샘플 단위 선형 보간 곡선으로."""
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


def fd_filter(x, mag):
    """원형(루프) 영위상 주파수 영역 필터."""
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


def env_adsr(n, a, d, s, r_len, sr=SR):
    ai = max(1, int(a * sr))
    e = np.full(n, s, dtype=np.float64)
    k = min(ai, n)
    e[:k] = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / ai)
    if d > 0:
        di = int(d * sr)
        seg = slice(ai, min(n, ai + di))
        tt = (np.arange(seg.stop - seg.start)) / max(1, di)
        e[seg] = 1.0 + (s - 1.0) * tt
    ri = int(r_len * sr)
    if 0 < ri < n:
        rel = e[n - ri - 1] if n - ri - 1 >= 0 else s
        tt = np.arange(ri) / ri
        e[n - ri:] = rel * (0.5 + 0.5 * np.cos(np.pi * tt))
    return e


def fade_tail(y, sec=0.02):
    k = min(len(y), int(sec * SR))
    y[-k:] *= np.linspace(1, 0, k)
    return y


def humanize(v, amt=0.12):
    return float(v * (1 - amt + 2 * amt * rng.random()))


# ───────────────────────── 화성 ─────────────────────────
# (근음 음이름류, 쌓기 음정[근음 뺀 rootless 4음])
PC = {"C": 0, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "Gb": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
CH = {
    "Fmaj9":  ("F", [4, 11, 14, 7]),
    "Em7":    ("E", [3, 10, 7, 12]),
    "A7b9":   ("A", [4, 10, 13, 7]),
    "Dm9":    ("D", [3, 10, 14, 7]),
    "Gm9":    ("G", [3, 10, 14, 7]),
    "C13":    ("C", [4, 10, 14, 21]),
    "Bbmaj9": ("Bb", [4, 11, 14, 7]),
    "Am9":    ("A", [3, 10, 14, 7]),
    "D9":     ("D", [4, 10, 14, 7]),
    "C7sus4": ("C", [5, 10, 14, 7]),
}
PROG_A = [[(0, "Fmaj9")], [(0, "Em7"), (8, "A7b9")], [(0, "Dm9")], [(0, "Gm9"), (8, "C13")]]
PROG_B = [[(0, "Bbmaj9")], [(0, "Am9")], [(0, "Gm9")], [(0, "C13")],
          [(0, "Am9")], [(0, "D9")], [(0, "Gm9")], [(0, "C7sus4"), (8, "C13")]]


def build_timeline():
    bars = []
    for b in range(BARS):
        if 36 <= b < 60:
            bars.append(PROG_B[(b - 36) % 8])
        elif 76 <= b < 84:
            bars.append(PROG_B[(b - 76) % 8])
        else:
            bars.append(PROG_A[b % 4])
    return bars


TL = build_timeline()


def root_pc(name):
    return PC[CH[name][0]]


def segments(b):
    """마디 b 의 [(시작 16분 칸, 길이 칸, 화음)]."""
    segs = TL[b % BARS]
    out = []
    for i, (s, name) in enumerate(segs):
        e = segs[i + 1][0] if i + 1 < len(segs) else 16
        out.append((s, e - s, name))
    return out


def chord_at(b, step):
    name = None
    for s, _, nm in segments(b):
        if s <= step:
            name = nm
    return name


def nearest(center, pc):
    best = None
    for m in range(int(center) - 6, int(center) + 7):
        if m % 12 == pc and (best is None or abs(m - center) < abs(best - center)):
            best = m
    return best


def voicing(name, center, n=4):
    r = root_pc(name)
    ivs = CH[name][1][:n]
    notes = sorted(nearest(center, (r + iv) % 12) for iv in ivs)
    for i in range(1, len(notes)):
        while notes[i] <= notes[i - 1]:
            notes[i] += 12
    return notes


def bass_root(name, lo=31):
    return lo + (root_pc(name) - lo) % 12


# ───────────────────────── 악기 ─────────────────────────
WOB_F = loopf(0.47)          # 테이프 와우(피치 흔들림) 주기, 300초 정수 주기


def ep_note(m, vel, dur, t0):
    """로즈풍 일렉트릭 피아노: 배율 1 FM(지수 감소) + 작은 틴 성분 + 테이프 와우."""
    rel = 0.35
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    wob = 1 + 0.0013 * np.sin(2 * np.pi * WOB_F * (t0 + t))
    ph = 2 * np.pi * np.cumsum(f * wob) / SR
    k = min(1.0, 330.0 / f)                   # 높은 음일수록 덜 밝게
    idx = (1.1 * np.exp(-t / 0.22) + 0.22) * k
    y = np.sin(ph + idx * np.sin(ph)) + 0.05 * np.sin(7 * ph) * np.exp(-t / 0.025) * k
    env = np.exp(-t / 2.2) * env_adsr(n, 0.004, 0.0, 1.0, rel)
    return (y * env * vel).astype(F32)


def mute_gtr(m, vel, dur, bright=1.0):
    """팜 뮤트 기타: 배음별 감쇠(높은 배음일수록 빨리) + 피크 잡음 어택."""
    f = mtof(m)
    tau1 = min(0.55, 0.16 + 0.22 * dur)
    length = min(dur + 0.25, tau1 * 5)
    n = int(length * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, 11):
        if k * f > 5000:
            break
        a = abs(math.sin(math.pi * k * 0.2)) / k ** 1.05 * (bright if k > 2 else 1.0)
        y += a * np.sin(2 * np.pi * k * f * t + 0.3 * k) * np.exp(-t * (1 + 0.9 * (k - 1)) / tau1)
    nz = rng.standard_normal(min(n, int(0.012 * SR)))
    nz = np.convolve(nz, np.ones(6) / 6, mode="same") * np.exp(-np.arange(len(nz)) / (0.003 * SR))
    y[: len(nz)] += 0.25 * nz
    y *= 1 - np.exp(-t / 0.0015)
    if dur + 0.2 < length:
        cut = int((dur + 0.05) * SR)
        y[cut:] *= np.exp(-(t[cut:] - t[cut]) / 0.05)
    return fade_tail(y * vel).astype(F32)


def vibe(m, vel, dur):
    """비브라폰: 기음(긴 감쇠) + 4배 부분음(짧게) + 모터 트레몰로, 부드러운 말렛."""
    f = mtof(m)
    length = min(dur + 0.5, 3.2)
    n = int(length * SR)
    t = np.arange(n) / SR
    trem = 1 - 0.22 * (0.5 - 0.5 * np.cos(2 * np.pi * 5.3 * t + rng.uniform(0, 6.28)))
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 1.6) * trem
    y += 0.12 * np.sin(2 * np.pi * 4.0 * f * t) * np.exp(-t / 0.18)
    y += 0.05 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / 0.08)
    y *= 1 - np.exp(-t / 0.0025)
    damp = int((dur + 0.15) * SR)
    if damp < n:
        y[damp:] *= np.exp(-(t[damp:] - t[damp]) / 0.12)
    return fade_tail(y * vel).astype(F32)


def pad_note(m, vel, dur):
    rel = 1.6
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    y = np.zeros(n)
    for det in (-0.07, 0.07):
        ff = f * (1 + det / 100 * 12)
        ph = 2 * np.pi * ff * t + rng.uniform(0, 6.28)
        y += np.sin(ph) + np.sin(3 * ph) / 9 + np.sin(5 * ph) / 25
    env = env_adsr(n, 1.2, 0.0, 1.0, rel)
    return (y * env * vel * 0.5).astype(F32)


def bass_note(m, vel, dur):
    rel = 0.09
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    y = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(4 * np.pi * f * t) + 0.05 * np.sin(6 * np.pi * f * t)
    y = np.tanh(1.2 * y) / np.tanh(1.2)
    env = env_adsr(n, 0.012, 0.35, 0.62, rel)
    return (y * env * vel).astype(F32)


def kick(vel):
    """둥근 킥: 낮은 피치 스윕, 클릭 거의 없음."""
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    f = 47 + 62 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.21) * (1 - np.exp(-t / 0.0035))
    y = np.tanh(1.2 * y) / np.tanh(1.2)
    return fade_tail(y * vel, 0.04).astype(F32)


def snare(vel, dark=1.0):
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (172 + 30 * np.exp(-t / 0.01)) * t) * np.exp(-t / 0.055)
    nz = rng.standard_normal(n)
    nz = np.convolve(nz, np.ones(3) / 3, mode="same") * np.exp(-t / (0.10 * dark))
    y = (0.55 * body + 0.5 * nz) * (1 - np.exp(-t / 0.0018))
    return fade_tail(y * vel).astype(F32)


def rim(vel):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * 1650 * t) * np.exp(-t / 0.010) + 0.4 * np.sin(2 * np.pi * 520 * t) * np.exp(-t / 0.02)
    y += 0.2 * rng.standard_normal(n) * np.exp(-t / 0.004)
    y *= 1 - np.exp(-t / 0.0008)
    return fade_tail(y * vel).astype(F32)


def hat(vel, decay=0.022, length=0.14, attack=0.0008):
    n = int(length * SR)
    t = np.arange(n) / SR
    y = rng.standard_normal(n) * np.exp(-t / decay) * (1 - np.exp(-t / attack))
    return fade_tail(y * vel, 0.01).astype(F32)


# ───────────────────────── 악보 ─────────────────────────
M1 = [(0.5, 72, 0.5), (1, 76, 1), (2, 74, 0.5), (2.5, 72, 1.5), (4.5, 71, 0.5), (5, 74, 0.5), (5.5, 76, 0.5),
      (6, 73, 1.5), (7.5, 70, 0.5)]
M2 = [(0.5, 69, 0.5), (1, 72, 0.5), (1.5, 74, 0.5), (2, 76, 2), (4.5, 74, 0.5), (5, 70, 1), (6, 69, 0.5), (6.5, 67, 1.5)]
M1v = [(0.5, 72, 0.5), (1, 76, 0.5), (1.5, 79, 0.5), (2, 81, 1), (3, 79, 0.5), (3.5, 76, 1), (4.5, 74, 0.5),
       (5, 71, 0.5), (5.5, 74, 0.5), (6, 73, 0.5), (6.5, 76, 1.5)]
M2v = [(0.5, 77, 0.5), (1, 76, 0.5), (1.5, 74, 0.5), (2, 72, 0.5), (2.5, 69, 1.5), (4.5, 70, 0.5), (5, 74, 0.5),
       (5.5, 77, 0.5), (6, 76, 2)]
B1 = [(0, 74, 1.5), (1.5, 72, 0.5), (2, 69, 1), (3, 72, 1), (4, 76, 1.5), (5.5, 74, 0.5), (6, 72, 2)]
B2 = [(0.5, 70, 0.5), (1, 74, 0.5), (1.5, 77, 1), (2.5, 76, 0.5), (3, 74, 1), (4.5, 72, 0.5), (5, 69, 1), (6, 67, 2)]
B3 = [(0, 76, 1), (1, 72, 0.5), (1.5, 74, 0.5), (2, 72, 1), (3, 69, 1), (4, 78, 1.5), (5.5, 76, 0.5), (6, 74, 2)]
B4 = [(0.5, 70, 0.5), (1, 72, 0.5), (1.5, 74, 1), (2.5, 79, 1.5), (4, 77, 1), (5, 74, 1), (6, 76, 2)]
MOTIFS = {"M1": M1, "M2": M2, "M1'": M1v, "M2'": M2v, "B1": B1, "B2": B2, "B3": B3, "B4": B4}

# (시작 마디, 모티프 이름, 악기, 세기, 옥타브, 앞 몇 박만)
MELODY = []
for b0, names, vel in [(20, ["M1", "M2", "M1", "M2'"], 0.15), (32, ["M1", "M2"], 0.15)]:
    for i, nm in enumerate(names):
        MELODY.append((b0 + 2 * i, nm, "gtr", vel, 0, 8))
for i, nm in enumerate(["B1", "B2", "B3", "B4"]):
    MELODY.append((44 + 2 * i, nm, "vibe", 0.12, 0, 8))
    MELODY.append((52 + 2 * i, nm, "vibe", 0.12, 0, 8))
    MELODY.append((52 + 2 * i, nm, "gtr", 0.11, -12, 8))
for i, nm in enumerate(["M1", "M2", "M1'", "M2'", "M1", "M2'", "M1'", "M2"]):
    MELODY.append((60 + 2 * i, nm, "vibe", 0.13, 0, 8))
    MELODY.append((60 + 2 * i, nm, "gtr", 0.12 if i >= 2 else 0.10, -12, 8))
MELODY += [(76, "B1", "vibe", 0.09, 0, 4), (80, "B3", "vibe", 0.09, 0, 4),
           (84, "M1", "gtr", 0.10, 0, 8), (86, "M2", "gtr", 0.10, 0, 4),
           (88, "M1", "gtr", 0.12, 0, 8), (90, "M2", "gtr", 0.12, 0, 8),
           (92, "M1", "vibe", 0.08, 0, 4)]


def score_melody(gbus, vbus):
    for b0, nm, inst, vel, octv, upto in MELODY:
        for beat, m, d in MOTIFS[nm]:
            if beat >= upto:
                continue
            bar = b0 + int(beat // 4)
            t0 = ts(bar, beat % 4) + 0.008          # 선율도 살짝 뒤로
            v = humanize(vel, 0.08)
            if inst == "gtr":
                add(gbus, t0, mute_gtr(m + octv, v, d * BEAT), pan=-0.22)
            else:
                add(vbus, t0, vibe(m + octv, v, d * BEAT), pan=0.2)


EP_PATS = [[(0, 8), (10, 5)], [(0, 14)], [(0, 6), (6, 2), (11, 4)], [(2, 6), (10, 5)], [(0, 4), (7, 8)]]
EP_PATS2 = [[(0, 7), (8, 7)], [(0, 6), (8, 4), (13, 3)], [(0, 3), (6, 2), (8, 7)], [(2, 5), (8, 7)]]


def ep_level(b):
    if b < 12:
        return 0.050
    if b < 60:
        return 0.046
    if b < 76:
        return 0.050
    if b < 88:
        return 0.044
    return 0.048


def score_ep(bus):
    pat_cache = {}
    for b in range(BARS):
        segs = segments(b)
        intro_like = b < 8 or b >= 96
        if intro_like:
            pat = [(s, l - 1) for s, l, _ in segs]
        else:
            key = (b // 2, len(segs))
            if key not in pat_cache:
                pool = EP_PATS2 if len(segs) > 1 else EP_PATS
                pat_cache[key] = pool[int(rng.integers(0, len(pool)))]
            pat = pat_cache[key]
        for s, l in pat:
            name = chord_at(b, s)
            vs = voicing(name, 63, 4)
            spread = 0.035 if intro_like else 0.012
            t0 = ts(b, s / 4)
            for i, m in enumerate(vs):
                v = humanize(ep_level(b) * (1.0 if s in (0, 8) else 0.85), 0.08)
                add(bus, t0 + i * spread, ep_note(m, v, l / 4 * BEAT, t0), pan=-0.3 + 0.2 * i)


def score_pad(bus):
    for b in range(36, 76):
        for s, l, name in segments(b):
            vs = voicing(name, 56, 3)
            lv = 0.022 if b < 60 else 0.028
            for m in vs:
                add(bus, tb(b, s / 4), pad_note(m, lv, l / 4 * BEAT + 0.3), pan=float(rng.uniform(-0.5, 0.5)))


def score_gtr_chucks(bus):
    for b in list(range(36, 52)) + list(range(60, 76)):
        for s in (6, 14):
            if rng.random() < 0.15:
                continue
            name = chord_at(b, s)
            r = root_pc(name)
            ivs = CH[name][1]
            for k, iv in enumerate((ivs[0], ivs[1])):
                m = nearest(64, (r + iv) % 12)
                add(bus, ts(b, s / 4) + 0.006 * k, mute_gtr(m, humanize(0.045, 0.15), 0.12, bright=0.6), pan=0.35)


def bass_level(b):
    if b < 4:
        return 0.0
    if b < 12:
        return 0.24 * min(1.0, (b - 3) / 3)
    if b < 76:
        return 0.30
    if b < 84:
        return 0.22
    if b < 94:
        return 0.28
    if b < 96:
        return 0.22
    return 0.0


def score_bass(bus):
    for b in range(BARS):
        v = bass_level(b)
        if v <= 0:
            continue
        segs = segments(b)
        long_only = b < 12 or 76 <= b < 84 or b >= 94
        nxt = segments((b + 1) % BARS)[0][2]
        for idx, (s, l, name) in enumerate(segs):
            root = bass_root(name)
            if long_only:
                add(bus, ts(b, s / 4), bass_note(root, humanize(v, 0.05), l / 4 * BEAT * 0.92))
                continue
            if l == 16:
                add(bus, ts(b, 0), bass_note(root, humanize(v, 0.05), 1.4 * BEAT))
                if rng.random() < 0.7:
                    iv = [0, 7, 12][int(rng.integers(0, 3))]
                    add(bus, ts(b, 2.5), bass_note(root + iv, humanize(v * 0.8, 0.06), 0.6 * BEAT))
            else:
                add(bus, ts(b, s / 4), bass_note(root, humanize(v, 0.05), 1.3 * BEAT))
            last = idx == len(segs) - 1
            if last and rng.random() < 0.6:
                tgt = bass_root(nxt)
                app = tgt + (-1 if rng.random() < 0.6 else 2)
                if app != root:
                    add(bus, ts(b, 3.5), bass_note(app, humanize(v * 0.7, 0.06), 0.45 * BEAT))


KICK_PATS = ["x.........x.....", "x......x..x.....", "x.........x..x..", "x.x.......x....."]


def drum_mode(b):
    if b < 8:
        return "none"
    if b < 12:
        return "hats"
    if b < 44:
        return "groove"
    if b < 76:
        return "full"
    if b < 84:
        return "break"
    if b < 88:
        return "build"
    if b < 94:
        return "groove_soft"
    if b < 96:
        return "tail"
    return "none"


def score_drums(kbus, sbus, hbus, trig):
    kpat = None
    for b in range(BARS):
        mode = drum_mode(b)
        if mode == "none":
            continue
        if b % 2 == 0:
            kpat = KICK_PATS[int(rng.integers(0, len(KICK_PATS)))]
        soft = 0.8 if mode in ("groove_soft", "tail") else 1.0
        phrase_end = (b % 8 == 7)
        # 킥
        if mode in ("groove", "full", "groove_soft", "build", "tail"):
            pat = kpat
            if mode == "build":
                pat = "x.......x......."
            if mode == "tail":
                pat = "x..............."
            for s, c in enumerate(pat):
                if c != "x" or (phrase_end and s >= 12 and mode != "tail"):
                    continue
                vv = humanize(0.62 * soft * (1.0 if s in (0, 10) else 0.82), 0.05)
                if mode == "build":
                    vv *= 0.55 + 0.12 * (b - 84)
                t0 = ts(b, s / 4, 0.002)
                add(kbus, t0, kick(vv))
                trig[int(round(t0 * SR)) % N] += vv
        # 스네어(레이백)·고스트
        if mode in ("groove", "full", "groove_soft"):
            for s in (4, 12):
                add(sbus, ts(b, s / 4, 0.003) + LAYBACK, snare(humanize(0.30 * soft, 0.06)), pan=0.06)
            ghost_p = 0.45 if mode == "full" else 0.3
            for s in (3, 7, 9, 15):
                if rng.random() < ghost_p:
                    add(sbus, ts(b, s / 4, 0.004) + LAYBACK * 0.6, snare(humanize(0.065 * soft, 0.3), dark=0.7), pan=-0.1)
            if phrase_end:
                for i, s in enumerate((13, 14, 15)):
                    add(sbus, ts(b, s / 4, 0.003) + LAYBACK * 0.5, snare(0.06 + 0.035 * i, dark=0.8), pan=-0.05)
        elif mode in ("break", "build", "tail"):
            for s in (4, 12):
                add(sbus, ts(b, s / 4, 0.003) + LAYBACK, rim(humanize(0.07, 0.08)), pan=0.1)
        if mode == "hats" and b == 11:
            for i, s in enumerate((12, 13, 14, 15)):
                add(sbus, ts(b, s / 4) + LAYBACK * 0.5, snare(0.05 + 0.03 * i, dark=0.8))
        # 하이햇
        hv = {"hats": 0.6, "groove": 1.0, "full": 1.0, "break": 0.65, "build": 0.8, "groove_soft": 0.8, "tail": 0.5}[mode]
        if mode == "hats":
            hv *= 0.5 + 0.15 * (b - 8)
        open_last = mode == "full" and b % 4 == 3
        for s in range(0, 16, 2):
            if open_last and s == 14:
                add(hbus, ts(b, s / 4), hat(0.035 * hv, decay=0.11, length=0.45), pan=0.3)
                continue
            vel = (0.055 if s % 4 == 0 else 0.040) * hv
            add(hbus, ts(b, s / 4, 0.003), hat(humanize(vel, 0.18)), pan=0.28)
        if mode in ("full", "groove", "build"):
            p = 0.38 if mode == "full" else 0.18
            for s in range(1, 16, 2):
                if rng.random() < p:
                    add(hbus, ts(b, s / 4, 0.003), hat(humanize(0.018 * hv, 0.3), decay=0.012), pan=-0.25)
        if mode in ("hats", "break"):          # 셰이커(부드러운 어택)
            for s in range(1, 16, 2):
                add(hbus, ts(b, s / 4), hat(humanize(0.02 * hv, 0.2), decay=0.03, length=0.12, attack=0.008), pan=-0.35)


def vinyl_bus():
    """바이닐: 표면 잡음 + 성긴 크래클 + 드문 팝(전부 원형 필터라 루프 연속)."""
    f = freqs()
    out = np.zeros((2, N), dtype=F32)
    rot = loopf(0.5556)                      # 33⅓ rpm
    t = np.arange(N, dtype=np.float64) / SR
    surf_mod = (0.8 + 0.2 * np.sin(2 * np.pi * rot * t)).astype(F32)
    del t
    for ch in range(2):
        surf = rng.standard_normal(N).astype(F32) * 0.010
        crack = np.zeros(N, dtype=F32)
        k = int(DUR * 5)
        idx = rng.integers(0, N, k)
        crack[idx] = (rng.exponential(1.0, k) * rng.choice([-1, 1], k) * 0.05).astype(F32)
        kp = int(DUR * 0.25)
        idx = rng.integers(0, N, kp)
        crack[idx] += (rng.uniform(0.15, 0.3, kp) * rng.choice([-1, 1], kp)).astype(F32)
        surf = fd_filter(surf, hp_mag(f, 400, 1) * lp_mag(f, 3500, 2)) * surf_mod
        crack = fd_filter(crack, hp_mag(f, 900, 1) * lp_mag(f, 4500, 2))
        out[ch] = surf + crack
    return out


def riser(bus):
    t0, t1 = tb(57), tb(60)
    n = int((t1 - t0) * SR)
    t = np.arange(n) / n
    y = rng.standard_normal((2, n)) * (t ** 2.5)[None, :] * 0.03
    y[:, -int(0.2 * SR):] *= np.linspace(1, 0, int(0.2 * SR))[None, :]
    add(bus, t0, y.astype(F32))


# ───────────────────────── 이펙트 ─────────────────────────

def reverb_ir(length=3.0, rt60_lo=2.4, rt60_hi=0.9):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.018 * SR)
    for ch in range(2):
        noise = rng.standard_normal(n)
        spec = np.fft.rfft(noise)
        fr = np.fft.rfftfreq(n, 1 / SR)
        lo = np.fft.irfft(spec * lp_mag(fr, 1500, 1), n=n)
        hi = np.fft.irfft(spec * hp_mag(fr, 1500, 1), n=n)
        tail = lo * np.exp(-6.91 * t / rt60_lo) + hi * np.exp(-6.91 * t / rt60_hi)
        tail *= 1 - np.exp(-t / 0.025)
        ir[ch, pre:] = tail[: n - pre]
        for k, ms in enumerate((9, 17, 23, 31, 43, 61)):
            idx = int((ms + (3 if ch else 0)) * SR / 1000)
            ir[ch, idx] += 0.5 * (0.8 ** k) * (1 if (k + ch) % 2 else -1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


def echo_ir(delay_beats=0.75, fb=0.32, taps=6):
    d = delay_beats * BEAT
    n = int(d * (taps + 1) * SR) + 16
    ir = np.zeros((2, n))
    for k in range(1, taps + 1):
        i = int(k * d * SR)
        ir[(k + 1) % 2, i] = fb ** (k - 1) * 0.5
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * lp_mag(fr, 2800, 1) * hp_mag(fr, 300, 1), n=n, axis=1)
    return ir.astype(F32)


def sidechain(trig, depth):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    shape = (1 - np.exp(-t / 0.010)) * np.exp(-t / 0.16)
    h = np.zeros(N, dtype=F32)
    h[:n] = shape
    env = np.fft.irfft(np.fft.rfft(trig) * np.fft.rfft(h), n=N)
    return np.clip(env, 0, 1).astype(F32)


# ───────────────────────── 측정·마스터링 (compose.py 재사용) ─────────────────────────

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
    y = (x * g[None, :]).astype(F32)
    return y, float(20 * np.log10(g.min()))


# ───────────────────────── 조립 ─────────────────────────

def bus_rms_db(x, b0=60, b1=76):
    seg = x[:, int(tb(b0) * SR):int(tb(b1) * SR)].astype(np.float64)
    return 20 * math.log10(max(1e-12, math.sqrt(float((seg ** 2).mean()))))


def render(log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()

    mix = new_bus()            # 로파이 톤 필터를 거치는 악기 합
    rev_send = new_bus()
    echo_send = new_bus()

    kbus, sbus, hbus = new_bus(), new_bus(), new_bus()
    trig = np.zeros(N, dtype=F32)
    score_drums(kbus, sbus, hbus, trig)
    sc = sidechain(trig, 1.0)
    kbus = fd_filter(kbus, hp_mag(f, 30, 2) * lp_mag(f, 2500, 2))
    sbus = fd_filter(sbus, hp_mag(f, 140, 1) * lp_mag(f, 4800, 2))
    hbus = fd_filter(hbus, hp_mag(f, 5500, 2) * lp_mag(f, 9500, 2))
    log(f"    (보정 전) 버스 RMS(클라이맥스): kick {bus_rms_db(kbus):.1f}  snare {bus_rms_db(sbus):.1f}  hat {bus_rms_db(hbus):.1f} dBFS")
    kbus *= F32(0.40)
    sbus *= F32(1.6)
    hbus *= F32(2.0)
    mix += kbus + sbus + hbus
    rev_send += 0.03 * kbus + 0.30 * sbus + 0.15 * hbus
    del kbus, sbus, hbus
    st("drums")

    e = new_bus()
    score_ep(e)
    tt = np.arange(N, dtype=np.float64) / SR
    trem = (0.13 * np.sin(2 * np.pi * loopf(3.2) * tt)).astype(F32)
    del tt
    e[0] *= 1 + trem
    e[1] *= 1 - trem
    del trem
    e = fd_filter(e, hp_mag(f, 110, 1) * lp_mag(f, 4200, 2))
    e *= (1.4 * (1 - 0.12 * sc))[None, :]
    log(f"    버스 RMS(클라이맥스): rhodes {bus_rms_db(e):.1f}")
    mix += e
    rev_send += 0.40 * e
    echo_send += 0.08 * e
    del e
    st("rhodes")

    p = new_bus()
    score_pad(p)
    p = fd_filter(p, lp_mag(f, 1400, 2) * hp_mag(f, 120, 1))
    p *= (1 - 0.15 * sc)[None, :]
    mix += p
    rev_send += 0.6 * p
    del p
    st("pad")

    g, v = new_bus(), new_bus()
    score_melody(g, v)
    score_gtr_chucks(g)
    g = fd_filter(g, hp_mag(f, 120, 1) * lp_mag(f, 3600, 2)) * F32(1.8)
    v = fd_filter(v, hp_mag(f, 150, 1) * lp_mag(f, 5000, 2))
    log(f"    버스 RMS(클라이맥스): guitar {bus_rms_db(g):.1f}  vibe {bus_rms_db(v):.1f}")
    mix += g + v
    rev_send += 0.35 * g + 0.5 * v
    echo_send += 0.25 * g + 0.35 * v
    del g, v
    st("guitar/vibe")

    bs = new_bus()
    score_bass(bs)
    bs = fd_filter(bs, lp_mag(f, 650, 2) * hp_mag(f, 32, 2))
    bs *= (0.55 * (1 - 0.18 * sc))[None, :]
    log(f"    버스 RMS(클라이맥스): bass {bus_rms_db(bs):.1f}")
    mix += bs
    rev_send += 0.04 * bs
    del bs, sc
    st("bass")

    rs = new_bus()
    riser(rs)
    rs = fd_filter(rs, hp_mag(f, 1200, 1) * lp_mag(f, 5000, 2))
    mix += rs
    rev_send += 0.8 * rs
    del rs

    echo = circ_conv(echo_send.mean(axis=0), echo_ir())
    mix += 0.45 * echo
    rev_send += 0.4 * echo
    del echo, echo_send
    st("echo")
    wet = circ_conv(rev_send, reverb_ir())
    wet = fd_filter(wet, hp_mag(f, 140, 1) * lp_mag(f, 6000, 1))
    mix += 0.26 * wet
    del wet, rev_send
    st("reverb")

    # 로파이 톤: 어두운(LP 950Hz)·밝은(LP 9kHz) 판을 구간별로 섞는다. 처음=끝 값으로 루프 연속
    bright = automation([(0, 0.05), (8, 0.25), (12, 0.75), (36, 0.82), (58, 0.9), (60, 1.0), (75.5, 1.0),
                         (76.5, 0.12), (83, 0.2), (87.8, 0.75), (88, 0.8), (94, 0.55), (100, 0.05)])
    dark = fd_filter(mix, lp_mag(f, 950, 2))
    mix = fd_filter(mix, lp_mag(f, 9000, 1))
    mix = dark * (1 - bright)[None, :] * 1.35 + mix * bright[None, :]
    del dark, bright
    st("lofi tone")

    vin = vinyl_bus()
    vin *= automation([(0, 1.0), (12, 0.55), (60, 0.45), (76, 0.9), (88, 0.6), (96, 1.0), (100, 1.0)])[None, :]
    mix += vin
    del vin
    st("vinyl")

    mix *= automation([(0, 0.55), (4, 1.0), (94, 1.0), (100, 0.55)])[None, :]
    mix = fd_filter(mix, hp_mag(f, 25, 2) * lp_mag(f, 12000, 1))

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


def fmt_t(sec):
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def stft_mono(x, nfft=4096):
    mono = x.mean(axis=0).astype(np.float64)
    nfr = len(mono) // nfft
    fr = mono[: nfr * nfft].reshape(nfr, nfft) * np.hanning(nfft)[None, :]
    P = np.abs(np.fft.rfft(fr, axis=1)) ** 2
    return P, np.fft.rfftfreq(nfft, 1 / SR), nfft


def analyze(x, log=print):
    P, fq, nfft = stft_mono(x)
    res = {"sections": [], "rms15": [], "rms1": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    for k, (name, b0) in enumerate(SECTIONS):
        i0, i1 = int(tb(b0) * SR), int(tb(bounds[k + 1]) * SR)
        seg = x[:, i0:i1].astype(np.float64)
        f0, f1 = i0 // nfft, i1 // nfft
        Ps = P[f0:f1]
        cent = float((Ps * fq[None, :]).sum() / Ps.sum())
        res["sections"].append(dict(name=name, b0=b0, b1=bounds[k + 1], t0=tb(b0), t1=tb(bounds[k + 1]),
                                    rms=db(math.sqrt(float((seg ** 2).mean()))), peak=db(float(np.abs(seg).max())),
                                    lufs=loudness(seg), centroid=cent))
    res["total_rms"] = db(math.sqrt(float((x.astype(np.float64) ** 2).mean())))
    res["total_peak"] = db(float(np.abs(x).max()))
    res["total_lufs"] = loudness(x)
    for w in range(20):
        seg = x[:, w * 15 * SR:(w + 1) * 15 * SR].astype(np.float64)
        res["rms15"].append(db(math.sqrt(float((seg ** 2).mean()))))
    sq = (x.astype(np.float64) ** 2).mean(axis=0)
    res["rms1"] = [db(math.sqrt(float(sq[i * SR:(i + 1) * SR].mean()))) for i in range(int(DUR))]
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    res["seam"] = dict(
        end50=db(math.sqrt((a ** 2).mean())), start50=db(math.sqrt((b ** 2).mean())),
        end1s=res["rms1"][-1], start1s=res["rms1"][0],
        jump=float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max()),
        typical=float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max()),
        lufs_end3=loudness(x[:, -3 * SR:]), lufs_start3=loudness(x[:, :3 * SR]))
    res["P"], res["fq"], res["nfft"] = P, fq, nfft
    log("\n구간별 에너지")
    for s in res["sections"]:
        log(f"  {s['name']:<6} {fmt_t(s['t0'])}～{fmt_t(s['t1'])}  RMS {s['rms']:7.2f}  피크 {s['peak']:7.2f}  "
            f"LUFS {s['lufs']:7.2f}  중심 {s['centroid']:7.0f} Hz")
    log(f"  전체  RMS {res['total_rms']:.2f}  피크 {res['total_peak']:.2f}  LUFS {res['total_lufs']:.2f}")
    sm = res["seam"]
    log(f"루프 이음매: 끝 50ms {sm['end50']:.2f} / 처음 50ms {sm['start50']:.2f} dBFS, 경계 샘플 차 {sm['jump']:.5f} "
        f"(인접 샘플 차 최대 {sm['typical']:.5f})")
    return res


def plot(res, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    P, fq, nfft = res["P"], res["fq"], res["nfft"]
    tt = (np.arange(P.shape[0]) + 0.5) * nfft / SR
    S = 10 * np.log10(P.T + 1e-12)
    S -= S.max()
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 7.5), sharex=True,
                                   gridspec_kw={"height_ratios": [3, 1.2]})
    sel = (fq >= 30) & (fq <= 16000)
    im = ax1.pcolormesh(tt, fq[sel], S[sel], shading="auto", cmap="magma", vmin=-95, vmax=0, rasterized=True)
    ax1.set_yscale("log")
    ax1.set_ylabel("주파수 (Hz)")
    ax1.set_title(f"{TITLE} — 스펙트로그램 (모노 합, 4096점 STFT)")
    fig.colorbar(im, ax=ax1, pad=0.01, label="dB (최대 기준)")
    for s in res["sections"]:
        for ax in (ax1, ax2):
            ax.axvline(s["t0"], color="#7fd3ff" if ax is ax1 else "#888", lw=0.8, ls="--")
        ax1.text(s["t0"] + 2, 18000 * 0.8, s["name"], color="white", fontsize=9, va="top")
    r1 = np.array(res["rms1"])
    ax2.plot(np.arange(len(r1)) + 0.5, r1, color="#4a7bd0", lw=1, label="1초 창 RMS")
    ax2.step(np.arange(21) * 15, res["rms15"] + res["rms15"][-1:], where="post", color="#d0704a", lw=1.6, label="15초 창 RMS")
    ax2.set_ylabel("RMS (dBFS)")
    ax2.set_xlabel("시간 (초)")
    ax2.set_ylim(min(r1.min(), -40) - 2, max(r1.max(), -10) + 2)
    ax2.set_xlim(0, DUR)
    ax2.grid(alpha=0.3)
    ax2.legend(loc="lower center", fontsize=8, ncol=2)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def write_report(path, res, meta, mp3_info, checks, gr, elapsed):
    L = []
    L.append(f"# {TITLE}")
    L.append("")
    L.append(f"> 생성: `compose_chillhop.py` (seed {SEED}) · {BPM} BPM · 4/4 · {BARS}마디 · F major · 16분 스윙 62% · "
             f"스네어 레이백 {int(LAYBACK * 1000)}ms · 합성 시간 {elapsed:.0f}초")
    L.append("")
    L.append("## 곡 구조")
    L.append("")
    L.append("| 구간 | 기승전결 | 시간 | 마디 | 화성 | 내용 |")
    L.append("|---|---|---|---|---|---|")
    harm = {"인트로": "A", "그루브": "A", "전개": "B", "클라이맥스": "A", "브레이크다운": "B → A(84～)", "아웃트로": "A"}
    for s in res["sections"]:
        L.append(f"| {s['name']} | {GIST[s['name']]} | {fmt_t(s['t0'])}～{fmt_t(s['t1'])} | {s['b0']}～{s['b1'] - 1} | "
                 f"{harm[s['name']]} | {SECTION_DESC[s['name']]} |")
    L.append("")
    L.append("- 화성 A(4마디): Fmaj9 | Em7–A7b9 | Dm9 | Gm9–C13 (iii–VI–ii–V 순환, 루프 이음매에서 C13→Fmaj9 해결)")
    L.append("- 화성 B(8마디): Bbmaj9 | Am9 | Gm9 | C13 | Am9 | D9 | Gm9 | C7sus4–C13")
    L.append("- 모티프: M1·M2(기타, A 화성 묻고 답하기), M1'·M2'(클라이맥스 변형, 최고음 A5), B1～B4(비브라폰, B 화성)")
    L.append("- 악기(전부 합성): 로즈풍 FM 피아노(트레몰로·테이프 와우), 팜 뮤트 기타(배음별 감쇠), 비브라폰(모터 트레몰로), "
             "웜 패드, 서브 베이스, 둥근 킥, 레이백 스네어·고스트, 하이햇·셰이커·림, 바이닐 표면 잡음·크래클")
    L.append("- 이펙트·마스터: 합성 IR 리버브, 점8분 딜레이, 킥 사이드체인(깊이 로즈 12%·패드 15%·베이스 18%), "
             f"로파이 톤 크로스페이드(LP 950Hz↔9kHz), 12kHz 완만한 LP, −16 LUFS 정규화, 룩어헤드 리미터(최대 GR {gr:.2f} dB), TPDF 디더")
    L.append("")
    L.append("## 구간별 RMS·LUFS·스펙트럼 중심")
    L.append("")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) |")
    L.append("|---|---|---:|---:|---:|---:|")
    for s in res["sections"]:
        L.append(f"| {s['name']} | {fmt_t(s['t0'])}～{fmt_t(s['t1'])} | {s['rms']:.2f} | {s['peak']:.2f} | "
                 f"{s['lufs']:.2f} | {s['centroid']:.0f} |")
    L.append(f"| **전체** | 0:00～5:00 | {res['total_rms']:.2f} | {res['total_peak']:.2f} | {res['total_lufs']:.2f} | — |")
    L.append("")
    L.append("## 15초 창 RMS 곡선")
    L.append("")
    L.append("| 시작 | 구간 | RMS (dBFS) | 곡선 (■ 1칸 = 1 dB, 기준 −40) |")
    L.append("|---|---|---:|---|")
    for w, r in enumerate(res["rms15"]):
        t0 = w * 15
        sec = [s["name"] for s in res["sections"] if s["t0"] <= t0][-1]
        L.append(f"| {fmt_t(t0)} | {sec} | {r:.2f} | {'■' * max(0, int(round(r + 40)))} |")
    L.append("")
    sm = res["seam"]
    L.append("## 루프 이음매")
    L.append("")
    L.append("| 항목 | 값 |")
    L.append("|---|---|")
    L.append(f"| 끝 50ms RMS / 처음 50ms RMS | {sm['end50']:.2f} / {sm['start50']:.2f} dBFS (차 {abs(sm['end50'] - sm['start50']):.2f} dB) |")
    L.append(f"| 끝 1초 RMS / 처음 1초 RMS | {sm['end1s']:.2f} / {sm['start1s']:.2f} dBFS |")
    L.append(f"| 끝 3초 LUFS / 처음 3초 LUFS | {sm['lufs_end3']:.2f} / {sm['lufs_start3']:.2f} |")
    L.append(f"| 경계 샘플 차(끝→처음) | {sm['jump']:.5f} (처음 1초 인접 샘플 차 최대 {sm['typical']:.5f}) |")
    L.append("| 방식 | 원형 버퍼 합성(꼬리·리버브·딜레이가 앞머리로 감김), 와우·트레몰로·바이닐 회전 LFO를 300초 정수 주기로, 톤·바이닐·마스터 자동화 처음=끝 |")
    L.append("| 남는 것 | MP3 인코더 지연(약 25ms) — `<audio loop>` 완전 무간격은 아님 |")
    L.append("")
    L.append("## 파일·검사")
    L.append("")
    L.append("| 항목 | 값 | 기준 | 결과 |")
    L.append("|---|---|---|---|")
    for row in checks:
        L.append(f"| {row[0]} | {row[1]} | {row[2]} | {'통과' if row[3] else '실패'} |")
    L.append("")
    L.append(f"- MP3: `{os.path.basename(mp3_info['path'])}` {mp3_info['size']:,} bytes ({mp3_info['size'] / 1048576:.2f} MB), "
             f"프레임 {mp3_info['frames']}, {BITRATE}kbps CBR, 44.1kHz 스테레오")
    L.append(f"- MP3 sha256: `{mp3_info['sha']}`")
    L.append(f"- PCM(int16) sha256: `{mp3_info['pcm_sha']}`")
    L.append("- 피크는 디코드 전 PCM 기준(이 PC에 MP3 디코더 없음). 샘플 피크 상한을 −1.5 dBFS로 두어 MP3 오버슈트 여유 0.5 dB를 남김")
    L.append("- 스펙트로그램: `spectrogram.png`")
    L.append("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="칠홉/로파이 재즈 작업 BGM 합성")
    ap.add_argument("--out", default=os.path.join(HERE, "bgm-chillhop.mp3"), help="MP3 출력 경로(같은 폴더에 .json·report.md·spectrogram.png)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV 도 저장(선택)")
    args = ap.parse_args(argv)

    t0 = time.time()
    print(f"합성 시작: {BPM} BPM, {BARS}마디, {DUR:.0f}초, seed {SEED}")
    mix, gr = render()
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
        print(f"WAV: {args.wav}")
    mp3 = encode_mp3(pcm)
    with open(out, "wb") as fh:
        fh.write(mp3)
    stem = os.path.splitext(out)[0]
    meta = {"duration": int(DUR), "bpm": BPM, "key": "F major",
            "sections": [{"name": n, "start": int(tb(b))} for n, b in SECTIONS], "seed": SEED,
            "title": TITLE, "mood": MOOD}
    with open(stem + ".json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs = mp3_frames(mp3)
    pk_pcm = db(float(np.abs(pcm.astype(np.float64)).max()) / 32767.0)
    fl = loudness(pcm.astype(np.float64) / 32767.0)
    checks = [
        ("길이", f"{secs:.3f}초", "300±0.5초", abs(secs - DUR) <= 0.5),
        ("크기", f"{len(mp3) / 1048576:.2f} MB", "≤ 8 MB", len(mp3) <= 8 * 1024 * 1024),
        ("샘플 피크(PCM)", f"{pk_pcm:.2f} dBFS", "≤ −1 dBFS", pk_pcm <= -1.0),
        ("통합 라우드니스", f"{fl:.2f} LUFS", "−16±1 LUFS", abs(fl - TARGET_LUFS) <= 1.0),
    ]
    plot(res, os.path.join(od, "spectrogram.png"))
    mp3_info = dict(path=out, size=len(mp3), frames=frames, sha=hashlib.sha256(mp3).hexdigest(),
                    pcm_sha=hashlib.sha256(pcm.tobytes()).hexdigest())
    elapsed = time.time() - t0
    write_report(os.path.join(od, "report.md"), res, meta, mp3_info, checks, gr, elapsed)
    print(f"\nMP3: {out}")
    print(f"  크기 {len(mp3):,} bytes, 프레임 {frames}, 길이 {secs:.3f}초, sha256 {mp3_info['sha']}")
    for c in checks:
        print(f"  {c[0]}: {c[1]} ({c[2]}) {'통과' if c[3] else '실패'}")
    ok = all(c[3] for c in checks)
    print(f"  검사: {'통과' if ok else '실패'}  (총 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
