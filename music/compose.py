#!/usr/bin/env python3
"""cc-agent-viz 배경음악 결정적 합성기.

외부 샘플 없이 numpy 만으로 5분(300초) 코딩 앰비언트 곡을 합성해
web/assets/bgm.mp3 (44.1kHz 스테레오 128kbps CBR) 와 bgm.json 을 만든다.

구조: 96 BPM, 4/4, 120마디 = 300초, D minor.
  기  0:00～1:15  (마디   0～29)  드론·패드, 성긴 벨, 잔잔한 아르페지오(후반), 비트 없음
  승  1:15～2:30  (마디  30～59)  소프트 킥·브러시 하이햇 진입, 베이스, 필터 조금 열림
  전  2:30～3:45  (마디  60～89)  화성 전환(Gm9-Ebmaj7#11-Bbmaj9-A7), 멜로디 모티프, 16분 아르페지오, 필터 최대
  결  3:45～5:00  (마디  90～119) 비트 빠짐, Dm9 패드로 귀결, 페이드아웃

루프: 모든 음·리버브·딜레이 꼬리는 원형 버퍼(길이 정확히 300초)로 앞머리에 감기고,
드론 주파수·LFO 주기는 300초에 정수 주기로 맞춰서 끝→처음 이음매가 끊기지 않는다.

사용법:
  python music/compose.py [--out web/assets/bgm.mp3] [--wav 미리듣기.wav] [--analyze-only]
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
BPM = 96
BEAT = 60.0 / BPM            # 0.625 s
BAR = 4 * BEAT               # 2.5 s
BARS = 120
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -1.5               # 샘플 피크 상한 (MP3 오버슈트 여유 포함, 계약 -1 dBFS 이하)
BITRATE = 128
SECTIONS = [("기", 0), ("승", 30), ("전", 60), ("결", 90)]

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(ROOT, "web", "assets", "bgm.mp3")

rng = np.random.default_rng(SEED)
F32 = np.float32


# ───────────────────────── 기본 유틸 ─────────────────────────

def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def loopf(f: float) -> float:
    """300초 동안 정수 주기가 되도록 주파수를 맞춘다(루프 이음매 위상 연속)."""
    return max(1, round(f * DUR)) / DUR


def tb(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


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
    """원형(루프) 영위상 주파수 영역 필터. mag 는 rfft 격자 위 크기 응답."""
    X = np.fft.rfft(x, axis=-1)
    X *= mag.astype(X.real.dtype)
    return np.fft.irfft(X, n=N, axis=-1).astype(F32)


def circ_conv(x, ir):
    """원형 FFT 컨볼루션. x:(2,N) 또는 (N,), ir:(2,M)."""
    out = np.zeros((2, N), dtype=F32)
    xs = x if x.ndim == 2 else np.stack([x, x])
    for ch in range(2):
        h = np.zeros(N, dtype=F32)
        h[: ir.shape[1]] = ir[ch]
        out[ch] = np.fft.irfft(np.fft.rfft(xs[ch]) * np.fft.rfft(h), n=N).astype(F32)
    return out


def env_adsr(n, a, d, s, r_len, sr=SR):
    """n 샘플(릴리스 포함) 엔벌로프. a,d,r_len 은 초."""
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
    if ri > 0 and ri < n:
        rel = e[n - ri - 1] if n - ri - 1 >= 0 else s
        tt = np.arange(ri) / ri
        e[n - ri:] = rel * (0.5 + 0.5 * np.cos(np.pi * tt))
    return e


def polyblep_saw(freq, n, phase0=0.0):
    dt = freq / SR
    ph = (phase0 + dt * np.arange(n)) % 1.0
    y = 2.0 * ph - 1.0
    m1 = ph < dt
    t = ph[m1] / dt
    y[m1] -= t + t - t * t - 1.0
    m2 = ph > 1.0 - dt
    t = (ph[m2] - 1.0) / dt
    y[m2] -= t * t + t + t + 1.0
    return y


# ───────────────────────── 화성 ─────────────────────────

CH = {
    "Dm9":    ([50, 53, 57, 60, 64], 38),
    "Bbmaj9": ([46, 53, 57, 60, 62], 34),
    "Fmaj7":  ([41, 53, 57, 60, 64], 41),
    "C69":    ([48, 55, 57, 62, 64], 36),
    "Gm9":    ([43, 50, 53, 57, 58], 43),
    "Ebmaj7#11": ([39, 51, 55, 58, 62], 39),
    "A7":     ([45, 52, 55, 57, 61], 45),
}
PROG_A = ["Dm9", "Bbmaj9", "Fmaj7", "C69"]
PROG_C = ["Gm9", "Ebmaj7#11", "Bbmaj9", "A7"]


def build_chords():
    bars = []
    for b in range(BARS):
        if b < 60:                       # 기·승
            lb = b if b < 30 else b - 30
            name = PROG_A[(lb // 2) % 4]
        elif b < 90:                     # 전
            lb = b - 60
            name = PROG_C[(lb // 2) % 4]
            if lb >= 28:
                name = "A7"              # 결 직전 딸림화음
        else:                            # 결
            lb = b - 90
            if lb < 16:
                name = ["Dm9", "Bbmaj9", "Gm9", "Dm9"][(lb // 2) % 4]
            elif lb < 18:
                name = "Bbmaj9"
            elif lb < 20:
                name = "Gm9"
            else:
                name = "Dm9"
        bars.append(name)
    return bars


CHORDS = build_chords()


def chord_events():
    ev = []
    start = 0
    for b in range(1, BARS + 1):
        if b == BARS or CHORDS[b] != CHORDS[start]:
            ev.append((start, b - start, CHORDS[start]))
            start = b
    return ev


# ───────────────────────── 악기 ─────────────────────────

def drone_bus():
    t = np.arange(N, dtype=np.float64) / SR
    out = np.zeros((2, N), dtype=F32)
    parts = [(mtof(26), 0.20), (mtof(38), 0.32), (mtof(45), 0.14), (mtof(50), 0.07)]
    for i, (f, a) in enumerate(parts):
        f = loopf(f)
        lfo = 0.75 + 0.25 * np.sin(2 * np.pi * loopf(1 / (17 + 6 * i)) * t + i)
        for ch, det in enumerate((-1, 1)):
            fd = loopf(f + det * 0.1 * (i + 1))
            out[ch] += (a * lfo * np.sin(2 * np.pi * fd * t + 0.7 * i * ch)).astype(F32)
    return out


def pad_bus():
    raw = new_bus()
    cents_l = (-9.0, 0.0, 7.0)
    cents_r = (-6.0, 3.0, 10.0)
    for bar0, nb, name in chord_events():
        notes, _ = CH[name]
        t0 = tb(bar0)
        dur = nb * BAR
        rel = 3.0
        n = int((dur + rel) * SR)
        env = env_adsr(n, 1.6, 0.0, 1.0, rel)
        amp = 0.09 / math.sqrt(len(notes))
        for k, m in enumerate(notes):
            f = mtof(m)
            w = 1.0 if k > 0 else 0.8
            for ch, cents in enumerate((cents_l, cents_r)):
                s = np.zeros(n)
                for c in cents:
                    s += polyblep_saw(f * 2 ** (c / 1200), n, rng.random())
                sig = (s * env * amp * w / len(cents)).astype(F32)
                tmp = np.zeros((2, n), dtype=F32)
                tmp[ch] = sig
                add(raw, t0, tmp)
    return raw


def bell(m, vel, length=3.2, ratio=2.0, index=2.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    idx = index * np.exp(-t / 0.35) + 0.25
    mod = np.sin(2 * np.pi * f * ratio * t)
    car = np.sin(2 * np.pi * f * t + idx * mod)
    env = np.exp(-t / (length * 0.32)) * (1 - np.exp(-t / 0.004))
    env[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
    return (car * env * vel).astype(F32)


def pluck(m, vel, length=0.9, bright=1.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    y = np.sin(2 * np.pi * f * t) + 0.35 * bright * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.12) \
        + 0.12 * bright * np.sin(6 * np.pi * f * t) * np.exp(-t / 0.06)
    env = np.exp(-t / (length * 0.28)) * (1 - np.exp(-t / 0.003))
    env[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    return (y * env * vel).astype(F32)


def lead(m, vel, dur):
    rel = 0.45
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    vib = 1 + 0.004 * np.clip((t - 0.35) / 0.4, 0, 1) * np.sin(2 * np.pi * 5.1 * t)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    idx = 0.9 * np.exp(-t / 0.25) + 0.35
    y = np.sin(ph + idx * np.sin(ph)) + 0.18 * np.sin(2 * ph)
    env = env_adsr(n, 0.03, 0.4, 0.75, rel)
    return (y * env * vel).astype(F32)


def kick(vel):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 46 + 78 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.20) * (1 - np.exp(-t / 0.0015))
    click = rng.standard_normal(n) * np.exp(-t / 0.0025) * 0.08
    y = np.tanh(1.4 * (y + click)) / np.tanh(1.4)
    y[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    return (y * vel).astype(F32)


def hat(vel, decay=0.018, length=0.12):
    n = int(length * SR)
    t = np.arange(n) / SR
    y = rng.standard_normal(n) * np.exp(-t / decay) * (1 - np.exp(-t / 0.0008))
    return (y * vel).astype(F32)


def snap(vel):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, d in enumerate((0.0, 0.009, 0.019)):
        tt = t - d
        m = tt >= 0
        y[m] += rng.standard_normal(m.sum()) * np.exp(-tt[m] / (0.004 if k < 2 else 0.07))
    y += 0.25 * np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.02)
    return (y * vel).astype(F32)


def bass_note(m, vel, dur):
    rel = 0.12
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    y = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    y = np.tanh(1.3 * y)
    env = env_adsr(n, 0.008, 0.25, 0.7, rel)
    return (y * env * vel).astype(F32)


# ───────────────────────── 악보 ─────────────────────────

def humanize(v, amt=0.12):
    return float(v * (1 - amt + 2 * amt * rng.random()))


def score_bells(bus):
    # 기: 성긴 벨 / 결: 더 성기게, 후반 모티프 회상
    for b in range(2, 30):
        if rng.random() < 0.72:
            notes = CH[CHORDS[b]][0]
            m = notes[int(rng.integers(1, len(notes)))] + (12 if rng.random() < 0.6 else 24)
            beat = [0, 1.5, 2, 3][int(rng.integers(0, 4))]
            add(bus, tb(b, beat), bell(m, humanize(0.16)), pan=float(rng.uniform(-0.6, 0.6)))
    for b in range(90, 116):
        if rng.random() < 0.45:
            notes = CH[CHORDS[b]][0]
            m = notes[int(rng.integers(1, len(notes)))] + 24
            add(bus, tb(b, [0, 2][int(rng.integers(0, 2))]), bell(m, humanize(0.11), length=4.0),
                pan=float(rng.uniform(-0.7, 0.7)))
    # 결: 전의 모티프를 벨로 한 번 회상 (마디 98～101)
    for beat, m, d in MOTIF["G"] + [(8 + b_, m_, d_) for b_, m_, d_ in MOTIF["Bb"]]:
        add(bus, tb(98, beat), bell(m, 0.07, length=3.0, ratio=3.0, index=1.2), pan=-0.2)


def score_arp(bus):
    for b in range(12, 106):
        notes = sorted(CH[CHORDS[b]][0][1:])
        notes = [n + 12 for n in notes]
        if 60 <= b < 90:
            steps, sub = 16, 0.25
            pat = [0, 2, 1, 3, 2, 4, 3, 1]
        else:
            steps, sub = 8, 0.5
            pat = [0, 1, 2, 3, 2, 1, 3, 2]
        for s in range(steps):
            if b < 30 and s % 2 == 1 and rng.random() < 0.5:
                continue                       # 기: 더 성기게
            m = notes[pat[s % len(pat)] % len(notes)]
            if steps == 16 and s % 4 == 2 and rng.random() < 0.3:
                m += 12
            beat = s * sub + (0.06 if (steps == 8 and s % 2 == 1) else 0.0)
            acc = 1.0 if s % 4 == 0 else 0.72
            add(bus, tb(b, beat), pluck(m, humanize(0.12 * acc), length=0.8 if steps == 8 else 0.5),
                pan=0.45 * math.sin(s * 0.9 + b))


MOTIF = {
    "G":  [(0, 74, 1.5), (1.5, 72, 0.5), (2, 70, 1), (3, 69, 1), (4, 67, 2), (6, 69, 1), (7, 70, 1)],
    "Eb": [(0, 70, 1.5), (1.5, 74, 0.5), (2, 79, 2), (4, 77, 1), (5, 74, 1), (6, 75, 2)],
    "Bb": [(0, 74, 1.5), (1.5, 72, 0.5), (2, 70, 1), (3, 69, 1), (4, 65, 2), (6, 67, 1), (7, 69, 1)],
    "A":  [(0, 73, 2), (2, 76, 1), (3, 74, 1), (4, 73, 4)],
}


def score_melody(bus):
    phrases = [(60, ["G", "Eb", "Bb", "A"], 0.06, False),
               (68, ["G", "Eb", "Bb", "A"], 0.10, False),
               (76, ["G", "Eb", "Bb", "A"], 0.12, True),
               (84, ["G", "Eb", "A"], 0.11, True)]
    for bar0, halves, vel, octave in phrases:
        for h, key in enumerate(halves):
            for beat, m, d in MOTIF[key]:
                t0 = tb(bar0 + 2 * h, beat)
                v = humanize(vel, 0.06)
                add(bus, t0, lead(m, v, d * BEAT * 0.95), pan=-0.1)
                if octave:
                    add(bus, t0 + 0.012, bell(m + 12, v * 0.35, length=2.0, ratio=3.0, index=1.0), pan=0.35)


def score_drums(kbus, hbus, sbus, trig):
    for b in range(32, 96):
        # 킥: 32～37 반박(1·3박), 38～87 4분, 결(90～95) 1박만 점점 약하게
        if b < 38:
            beats = [0, 2]
            v = 0.5 + 0.08 * (b - 32)
        elif b < 88:
            beats = [0, 1, 2, 3]
            v = 0.85 if b < 60 else 0.95
        elif b < 90:
            beats = [0, 2.5] if b == 89 else [0, 2]
            v = 0.8
        else:
            beats = [0]
            v = 0.7 - 0.1 * (b - 90)
        for be in beats:
            vv = humanize(v, 0.05) * (1.0 if be == 0 else 0.86)
            add(kbus, tb(b, be), kick(vv))
            i = int(round(tb(b, be) * SR)) % N
            trig[i] += vv
        # 하이햇: 34～ 8분 스윙, 전 16분 고스트
        if 34 <= b < 92:
            for s in range(8):
                beat = s * 0.5 + (0.07 if s % 2 else 0.0)
                vel = (0.10 if s % 2 else 0.05) * min(1.0, (b - 33) / 4)
                if b >= 90:
                    vel *= 0.5
                add(hbus, tb(b, beat), hat(humanize(vel, 0.2)), pan=0.25)
            if 64 <= b < 88:
                for s in range(16):
                    if s % 2 == 1 and rng.random() < 0.45:
                        add(hbus, tb(b, s * 0.25 + 0.03), hat(humanize(0.035, 0.3), decay=0.01), pan=-0.3)
            if b % 4 == 3 and b < 88:   # 4마디마다 브러시 스윕
                add(hbus, tb(b, 3.5), hat(0.05, decay=0.09, length=0.4), pan=0.1)
        # 림/스냅 2·4박: 전
        if 64 <= b < 88:
            for be in (1, 3):
                add(sbus, tb(b, be), snap(humanize(0.09, 0.1)), pan=0.05)


def score_bass(bus):
    pat_a = [(0, 0, 1.4), (1.5, 0, 0.45), (2.5, 7, 0.9), (3.5, 12, 0.4)]
    pat_c = [(0, 0, 0.9), (1, 12, 0.4), (1.5, 0, 0.4), (2.5, 7, 0.4), (3, 10, 0.4), (3.5, 7, 0.4)]
    for b in range(36, 100):
        root = CH[CHORDS[b]][1]
        while root > 45:
            root -= 12
        while root < 33:
            root += 12
        if b < 60:
            pat = pat_a
            v = 0.30 * min(1.0, (b - 35) / 3)
        elif b < 88:
            pat = pat_c if (b % 2 == 1) else pat_a
            v = 0.32
        elif b < 90:
            pat = pat_a
            v = 0.30
        else:                                     # 결: 온음표로 사라짐
            pat = [(0, 0, 3.8)]
            v = 0.26 * (1 - (b - 90) / 10)
        if CHORDS[b] == "A7" and pat is pat_c:
            pat = pat_a
        for beat, iv, d in pat:
            add(bus, tb(b, beat), bass_note(root + iv, humanize(v, 0.06), d * BEAT))


def riser(bus):
    # 승→전 전환(마디 58～60)의 부드러운 노이즈 상승
    t0, t1 = tb(57), tb(60)
    n = int((t1 - t0) * SR)
    t = np.arange(n) / n
    y = rng.standard_normal((2, n)) * (t ** 2.5)[None, :] * 0.05
    y[:, -int(0.15 * SR):] *= np.linspace(1, 0, int(0.15 * SR))[None, :]
    add(bus, t0, y.astype(F32))


# ───────────────────────── 이펙트 ─────────────────────────

def reverb_ir(length=4.2, rt60_lo=3.6, rt60_hi=1.4):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.022 * SR)
    for ch in range(2):
        noise = rng.standard_normal(n)
        spec = np.fft.rfft(noise)
        fr = np.fft.rfftfreq(n, 1 / SR)
        lo = np.fft.irfft(spec * lp_mag(fr, 1800, 1), n=n)
        hi = np.fft.irfft(spec * hp_mag(fr, 1800, 1), n=n)
        tail = lo * np.exp(-6.91 * t / rt60_lo) + hi * np.exp(-6.91 * t / rt60_hi)
        tail *= 1 - np.exp(-t / 0.03)
        ir[ch, pre:] = tail[: n - pre]
        # 초기 반사: 다중 딜레이 탭
        for k, ms in enumerate((11, 19, 29, 37, 53, 71, 89)):
            idx = int((ms + (3 if ch else 0)) * SR / 1000)
            ir[ch, idx] += 0.5 * (0.8 ** k) * (1 if (k + ch) % 2 else -1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


def echo_ir(delay_beats=0.75, fb=0.38, taps=8):
    d = delay_beats * BEAT
    n = int(d * (taps + 1) * SR) + 16
    ir = np.zeros((2, n))
    for k in range(1, taps + 1):
        i = int(k * d * SR)
        ir[(k + 1) % 2, i] = fb ** (k - 1) * 0.6
    # 꼬리를 조금씩 어둡게
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * lp_mag(fr, 3500, 1), n=n, axis=1)
    return ir.astype(F32)


def sidechain(trig, depth=0.42):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    shape = (1 - np.exp(-t / 0.006)) * np.exp(-t / 0.17)
    h = np.zeros(N, dtype=F32)
    h[:n] = shape
    env = np.fft.irfft(np.fft.rfft(trig) * np.fft.rfft(h), n=N)
    return (1 - depth * np.clip(env, 0, 1)).astype(F32)


# ───────────────────────── 측정·마스터링 ─────────────────────────

def _biquad_mag(f, b, a):
    w = 2 * np.pi * f / SR
    z1 = np.exp(-1j * w)
    z2 = z1 * z1
    return np.abs((b[0] + b[1] * z1 + b[2] * z2) / (a[0] + a[1] * z1 + a[2] * z2))


def k_weight_mag(f):
    # BS.1770 K 가중(고역 셸프 + RLB 하이패스), RBJ 식으로 44.1kHz 재계산
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
    """길이 w 중앙 정렬 슬라이딩 최소(van Herk/Gil-Werman, 원형)."""
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

def render(log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()

    mix = new_bus()
    rev_send = new_bus()
    echo_send = new_bus()

    # 사이드체인용 킥 트리거와 드럼 먼저(덕킹 곡선 필요)
    kbus, hbus, sbus = new_bus(), new_bus(), new_bus()
    trig = np.zeros(N, dtype=F32)
    score_drums(kbus, hbus, sbus, trig)
    duck = sidechain(trig)
    hbus = fd_filter(hbus, hp_mag(f, 6500, 2) * lp_mag(f, 13000, 1))
    sbus = fd_filter(sbus, hp_mag(f, 900, 1) * lp_mag(f, 5200, 2))
    kbus = fd_filter(kbus, hp_mag(f, 30, 2))
    mix += 0.9 * kbus + hbus + sbus
    rev_send += 0.05 * kbus + 0.35 * hbus + 0.6 * sbus
    del kbus, hbus, sbus
    st("drums")

    # 필터 밝기 자동화(패드·아르페지오 공용): 전에서 열림
    bright = automation([(0, 0.12), (30, 0.18), (56, 0.40), (60, 0.50), (78, 1.0), (88, 0.85),
                         (90, 0.45), (104, 0.18), (120, 0.12)])

    d = drone_bus()
    d *= automation([(0, 0.9), (30, 0.8), (60, 0.65), (90, 0.85), (120, 0.9)])[None, :]
    d = fd_filter(d, hp_mag(f, 28, 2))
    mix += d
    rev_send += 0.15 * d
    del d
    st("drone")

    p = pad_bus()
    pd = fd_filter(p, lp_mag(f, 420, 2) * hp_mag(f, 70, 1))
    pb = fd_filter(p, lp_mag(f, 4200, 2) * hp_mag(f, 90, 1))
    del p
    p = pd * (1 - bright)[None, :] + pb * (1.6 * bright)[None, :]
    del pd, pb
    p *= automation([(0, 0.8), (26, 0.8), (30, 0.85), (60, 0.9), (88, 1.0), (90, 1.0), (120, 1.0)])[None, :]
    p *= (0.35 + 0.65 * duck)[None, :]
    mix += p
    rev_send += 0.55 * p
    del p
    st("pad")

    a = new_bus()
    score_arp(a)
    ad = fd_filter(a, lp_mag(f, 1100, 2))
    ab = fd_filter(a, lp_mag(f, 6500, 1))
    del a
    a = ad * (1 - bright)[None, :] + ab * bright[None, :]
    del ad, ab
    a *= automation([(12, 0.0), (20, 0.55), (29, 0.7), (30, 0.75), (60, 0.85), (88, 1.0),
                     (90, 0.6), (104, 0.0)])[None, :]
    a *= (0.6 + 0.4 * duck)[None, :]
    mix += a
    rev_send += 0.45 * a
    echo_send += 0.25 * a
    del a
    st("arp")

    bl = new_bus()
    score_bells(bl)
    mix += 0.8 * bl
    rev_send += 0.7 * bl
    echo_send += 0.45 * bl
    del bl
    st("bells")

    ml = new_bus()
    score_melody(ml)
    ml = fd_filter(ml, lp_mag(f, 5000, 1))
    mix += ml
    rev_send += 0.5 * ml
    echo_send += 0.4 * ml
    del ml
    st("melody")

    bs = new_bus()
    score_bass(bs)
    bs = fd_filter(bs, lp_mag(f, 900, 2) * hp_mag(f, 32, 2))
    bs *= (0.45 + 0.55 * duck)[None, :]
    mix += bs
    rev_send += 0.06 * bs
    del bs
    st("bass")

    rs = new_bus()
    riser(rs)
    rs = fd_filter(rs, hp_mag(f, 1500, 1) * lp_mag(f, 7000, 2))
    mix += rs
    rev_send += 0.8 * rs
    del rs

    # 이펙트 리턴
    echo = circ_conv(echo_send.mean(axis=0), echo_ir())
    mix += 0.55 * echo
    rev_send += 0.5 * echo
    del echo, echo_send
    st("echo")
    wet = circ_conv(rev_send, reverb_ir())
    wet = fd_filter(wet, hp_mag(f, 120, 1) * lp_mag(f, 9000, 1))
    mix += 0.32 * wet
    del wet, rev_send
    st("reverb")

    # 마스터: 전체 페이드(처음과 끝을 같은 수준으로 이어 루프 이음매 연속)
    mix *= automation([(0, 0.22), (5, 1.0), (106, 1.0), (114, 0.55), (120, 0.22)])[None, :]
    mix = fd_filter(mix, hp_mag(f, 25, 2))

    lufs0 = loudness(mix)
    mix *= F32(10 ** ((TARGET_LUFS - lufs0) / 20))
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
    # 리미터가 깎은 만큼 한 번 더 맞춤(최대 2회)
    for _ in range(2):
        l1 = loudness(mix)
        if abs(l1 - TARGET_LUFS) < 0.3:
            break
        mix *= F32(10 ** ((TARGET_LUFS - l1) / 20))
        mix, gr2 = limiter(mix, ceil)
        gr = min(gr, gr2)
    pk = float(np.abs(mix).max())
    if pk > ceil:
        mix *= F32(ceil / pk)
    st(f"master (limiter max GR {gr:.2f} dB)")
    return mix


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


def analyze(x, log=print):
    def db(v):
        return 20 * math.log10(max(v, 1e-12))
    log("\n구간별 에너지")
    log("  구간  시간           RMS(dBFS)  피크(dBFS)  LUFS(근사)")
    rows = []
    bounds = [s for _, s in SECTIONS] + [BARS]
    for k, (name, b0) in enumerate(SECTIONS):
        i0, i1 = int(tb(b0) * SR), int(tb(bounds[k + 1]) * SR)
        seg = x[:, i0:i1].astype(np.float64)
        rms = math.sqrt(float((seg ** 2).mean()))
        pk = float(np.abs(seg).max())
        lu = loudness(seg)
        rows.append((name, rms, pk, lu))
        t0 = tb(b0)
        t1 = tb(bounds[k + 1])
        log(f"  {name}    {int(t0)//60}:{int(t0)%60:02d}～{int(t1)//60}:{int(t1)%60:02d}      {db(rms):7.2f}   {db(pk):8.2f}   {lu:8.2f}")
    total_rms = math.sqrt(float((x.astype(np.float64) ** 2).mean()))
    log(f"  전체  0:00～5:00      {db(total_rms):7.2f}   {db(float(np.abs(x).max())):8.2f}   {loudness(x):8.2f}")
    log("\n15초 창 RMS 곡선 (dBFS, ■ 1칸 = 1 dB, 기준 -40)")
    for w in range(20):
        seg = x[:, w * 15 * SR:(w + 1) * 15 * SR].astype(np.float64)
        r = db(math.sqrt(float((seg ** 2).mean())))
        sec = SECTIONS[min(3, w // 5)][0]
        log(f"  {w*15//60}:{w*15%60:02d} {sec} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    # 루프 이음매: 끝 50ms 와 처음 50ms 의 RMS·마지막/첫 샘플 차
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    jump = float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max())
    log(f"\n루프 이음매: 끝 50ms RMS {db(math.sqrt((a**2).mean())):.2f} dBFS, 처음 50ms RMS "
        f"{db(math.sqrt((b**2).mean())):.2f} dBFS, 경계 샘플 차 {jump:.5f} (전형적 인접 샘플 차 "
        f"{float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max()):.5f})")
    return rows


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="cc-agent-viz 배경음악 합성")
    ap.add_argument("--out", default=DEFAULT_OUT, help="MP3 출력 경로 (bgm.json 은 같은 폴더)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV 도 저장(선택, 레포에는 커밋하지 않음)")
    args = ap.parse_args(argv)

    print(f"합성 시작: {BPM} BPM, {BARS}마디, {DUR:.0f}초, seed {SEED}")
    mix = render()
    analyze(mix)
    pcm = to_int16(mix)
    del mix
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
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
    meta = {"duration": int(DUR), "bpm": BPM, "key": "D minor",
            "sections": [{"name": n, "start": int(tb(b))} for n, b in SECTIONS], "seed": SEED}
    with open(os.path.join(os.path.dirname(out), "bgm.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs = mp3_frames(mp3)
    print(f"\nMP3: {out}")
    print(f"  크기 {len(mp3):,} bytes ({len(mp3)/1048576:.2f} MB), 프레임 {frames}, 길이 {secs:.3f}초, {BITRATE}kbps CBR")
    print(f"  PCM sha256 {hashlib.sha256(pcm.tobytes()).hexdigest()[:16]}…  MP3 sha256 {hashlib.sha256(mp3).hexdigest()}")
    ok = abs(secs - DUR) <= 0.5 and len(mp3) <= 8 * 1024 * 1024
    print("  검사:", "통과" if ok else "실패")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
