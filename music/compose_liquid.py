#!/usr/bin/env python3
"""'빠른 물살' 작업 배경음악(활동 단계 3, 매우 활발) 결정적 합성기.

172 BPM 리퀴드 드럼앤베이스를 numpy 로 합성해 5분(300초) MP3 로 만든다. 외부 샘플·실존 곡 인용 없음.
마스터링·원형 루프·검사·MP3 부분은 music/compose_city.py(← compose.py)를 복사해 재사용했다.

구조: 172 BPM, 4/4, 215마디 = 정확히 300초, F minor.
  기  0:00～0:33  (마디   0～23)  패드·벨 → 하프타임 드럼(킥 1박·스네어 3박), 서브 베이스 긴 음
  승  0:33～2:25  (마디  24～103) 풀 템포 투스텝 브레이크비트 + 롤링 서브/리스 베이스 + EP 컴핑,
                                   플루트 모티프 예고, 중간에 하프타임 숨 고르기
  전  2:25～3:42  (마디 104～158) 3마디 상승 → 클라이맥스(2:29～3:42): 화성 Dbmaj9–Eb(add9)–Cm11–Fm9,
                                   플루트+벨 옥타브 모티프, 라이드, 필터 최대
  결  3:42～5:00  (마디 159～214) 하프타임 정리(벨 회상) → 드럼·베이스 빠지고 패드·벨로 귀결 → 처음으로
기본 화성 Fm9–Dbmaj9–Bbm9–Eb9sus4 (2마디씩). 마지막 Eb9sus4 → 첫 Fm9 로 루프가 이어진다.

사용법:
  python compose_liquid.py --out bgm-liquid.mp3 [--wav 미리듣기.wav]
  (같은 폴더에 bgm-liquid.json, report.md, spectrogram.png 도 만든다)
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

SEED = 1720
SR = 44100
BPM = 172
BEAT = 60.0 / BPM            # 0.3488 s
ST = BEAT / 4                # 16분음표 0.0872 s
BAR = 4 * BEAT               # 1.3953 s
BARS = 215
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
KEY_NAME = "F minor"
TITLE = "빠른 물살"
MOOD = "리퀴드 드럼앤베이스 — 둥근 킥·부드러운 브레이크비트, 롤링 서브 베이스, 몽환적 패드·EP(마이너 9), 플루트·벨 모티프"
STAGE = 3
ENERGY = 0.85
SECTIONS = [("기", 0), ("승", 24), ("전", 104), ("결", 159)]

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "bgm-liquid.mp3")

rng = np.random.default_rng(SEED)          # 합성용(잡음·위상)
hrng = np.random.default_rng(SEED + 1)     # 연주 흔들림(세기·타이밍)
F32 = np.float32

# ───────────────────────── 기본 유틸 (compose_city.py ← compose.py 에서 복사) ─────────────────────────

def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


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


def shelf_hi(f, fc=6000.0, gain_db=-5.0, order=2):
    """fc 위를 gain_db 만큼 누르는 하이셸프(크기 응답)."""
    g = 10 ** (gain_db / 20)
    return 1 + (g - 1) * hp_mag(f, fc, order)


def hp_mag(f, fc, order=2):
    r = (f / fc) ** (2 * order)
    return np.sqrt(r / (1.0 + r))


def fd_filter(x, mag):
    """원형(루프) 영위상 주파수 영역 필터. mag 는 rfft 격자 위 크기 응답."""
    X = np.fft.rfft(x, axis=-1)
    X *= mag.astype(X.real.dtype)
    return np.fft.irfft(X, n=N, axis=-1).astype(F32)


def fd_split(x, mag_dark, mag_bright, bright):
    """rfft 한 번으로 어두운·밝은 두 필터 결과를 bright 곡선으로 섞는다."""
    X = np.fft.rfft(x, axis=-1)
    d = np.fft.irfft(X * mag_dark.astype(np.float32), n=N, axis=-1).astype(F32)
    b = np.fft.irfft(X * mag_bright.astype(np.float32), n=N, axis=-1).astype(F32)
    del X
    d *= (1 - bright)[None, :]
    b *= bright[None, :]
    return d + b


def circ_conv(x, ir):
    """원형 FFT 컨볼루션. x:(2,N) 또는 (N,), ir:(2,M)."""
    out = np.zeros((2, N), dtype=F32)
    xs = x if x.ndim == 2 else np.stack([x, x])
    for ch in range(2):
        h = np.zeros(N, dtype=F32)
        h[: ir.shape[1]] = ir[ch]
        out[ch] = np.fft.irfft(np.fft.rfft(xs[ch]) * np.fft.rfft(h), n=N).astype(F32)
    return out


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

def _t(n):
    return np.arange(n) / SR


def _fade_tail(y, ms=6):
    k = min(len(y), int(ms * SR / 1000))
    y[-k:] *= np.linspace(1, 0, k)
    return y


def env_target(t, a, peak, tau, sus, end, rel):
    """music.js adsr(): 선형 어택 → setTargetAtTime 감쇠(지속 sus) → end 에서 rel 로 0."""
    end = max(end, a + 0.01)
    e = np.where(t < a, peak * t / a, peak * sus + peak * (1 - sus) * np.exp(-(t - a) / tau))
    ve = peak * sus + peak * (1 - sus) * math.exp(-(end - a) / tau)
    return np.where(t >= end, ve * np.exp(-(t - end) / rel), e)


def _fade_tail_st(y, ms=6):
    k = min(y.shape[1], int(ms * SR / 1000))
    y[:, -k:] *= np.linspace(1, 0, k)[None, :]
    return y


# ───────────────────────── 화성 · 구간 ─────────────────────────

# (베이스 MIDI, 패드 보이싱). 모두 F 자연단음계 안의 음만 쓴다(Cm11 = C Eb G Bb F).
CH = {
    "Fm9": (29, [53, 56, 60, 63, 67]),      # F Ab C Eb G
    "Dbmaj9": (37, [49, 56, 60, 63, 65]),   # Db Ab C Eb F
    "Bbm9": (34, [46, 53, 56, 60, 61]),     # Bb F Ab C Db
    "Eb9sus4": (39, [51, 56, 58, 61, 65]),  # Eb Ab Bb Db F
    "Ebadd9": (39, [51, 55, 58, 63, 65]),   # Eb G Bb Eb F
    "Cm11": (36, [48, 55, 58, 63, 65]),     # C G Bb Eb F
}
MAIN = ["Fm9", "Dbmaj9", "Bbm9", "Eb9sus4"]
CLIM = ["Dbmaj9", "Ebadd9", "Cm11", "Fm9"]

SECS = [
    dict(n="인트로 패드", bars=8, big="기", kind="pad"),
    dict(n="인트로 하프타임", bars=16, big="기", kind="introH"),
    dict(n="풀 템포 A", bars=32, big="승", kind="full"),
    dict(n="풀 템포 B · 모티프 예고", bars=16, big="승", kind="fullB"),
    dict(n="숨 고르기(하프타임)", bars=8, big="승", kind="breath"),
    dict(n="풀 템포 C", bars=24, big="승", kind="fullC"),
    dict(n="상승", bars=3, big="전", kind="rise"),
    dict(n="클라이맥스", bars=52, big="전", kind="climax"),
    dict(n="하프타임 정리", bars=32, big="결", kind="outH"),
    dict(n="패드 귀결", bars=24, big="결", kind="padEnd"),
]
SEC_START = {}
_MAP = []
_b = 0
for _s in SECS:
    SEC_START[_s["n"]] = _b
    for _r in range(_s["bars"]):
        _MAP.append((_s, _r))
    _b += _s["bars"]
assert _b == BARS


def sec_of(bar):
    return _MAP[bar % BARS]


def chord_at(bar):
    s, rel = sec_of(bar)
    if s["kind"] == "rise":
        return "Dbmaj9" if rel < 2 else "Eb9sus4"
    prog = CLIM if s["kind"] == "climax" else MAIN
    return prog[(rel // 2) % 4]


def chord_blocks():
    """같은 화음이 이어지는 마디 묶음 [(시작 마디, 마디 수, 화음)]."""
    out = []
    for b in range(BARS):
        c = chord_at(b)
        if out and out[-1][2] == c and b - out[-1][0] < 2:
            out[-1] = (out[-1][0], out[-1][1] + 1, c)
        else:
            out.append((b, 1, c))
    return out


# 선율(박, MIDI, 길이 박) — 8마디 = 32박. 직접 지은 동기(실존 곡 인용 없음).
PH_A = [(0, 72, 2), (2, 75, 1), (3, 77, 3), (6, 75, 1), (7, 72, 1),
        (8, 73, 3), (11, 72, 1), (12, 68, 4),
        (16, 70, 2), (18, 72, 1), (19, 73, 3), (22, 72, 1), (23, 70, 1),
        (24, 75, 2), (26, 73, 1), (27, 70, 5)]
PH_B = [(0, 77, 2), (2, 75, 1), (3, 72, 3), (6, 70, 1), (7, 72, 1),
        (8, 73, 2), (10, 75, 2), (12, 77, 4),
        (16, 77, 1), (17, 75, 1), (18, 73, 2), (20, 72, 4),
        (24, 70, 2), (26, 68, 2), (28, 70, 2), (30, 72, 2)]
PH_C = [(0, 77, 2), (2, 75, 1), (3, 73, 3), (6, 72, 1), (7, 73, 1),
        (8, 75, 2), (10, 77, 1), (11, 79, 5),
        (16, 75, 2), (18, 72, 1), (19, 70, 3), (22, 72, 2),
        (24, 72, 2), (26, 68, 2), (28, 67, 1), (29, 68, 3)]
PH_END = [(0, 77, 6), (6, 75, 2), (8, 77, 8)]


# ───────────────────────── 편곡(이벤트) ─────────────────────────

SW = 0.11 * ST     # 홀수 16분 셔플 지연(약 9.6ms)


def build_events():
    ev = []

    def E(ins, t, v, m=0, d=0.0, pan=0.0, **kw):
        ev.append(dict(ins=ins, t=float(t), v=float(v), m=m, d=float(d), pan=float(pan), **kw))

    def hum(v, s=0.06):
        return max(0.02, v * (1 + hrng.normal(0, s)))

    for bar in range(BARS):
        s, rel = sec_of(bar)
        k = s["kind"]
        t0 = tb(bar)

        def at(step, swing=True):
            return t0 + step * ST + (SW if (swing and step % 2 == 1) else 0.0) + hrng.normal(0, 0.0015)

        # ── 드럼 ──
        if k in ("full", "fullB", "fullC", "climax"):
            I = {"full": 0.86, "fullB": 0.9, "fullC": 0.93, "climax": 1.0}[k]
            var = rel % 4
            kicks = [0, 10] if var != 2 else [0, 2, 10]
            fill16 = (rel % 16 == 15) and rel != s["bars"] - 1
            fill8 = (rel % 8 == 7) and not fill16
            if fill16:
                kicks = [0, 6]
            for st_ in kicks:
                E("kick", at(st_, False), hum(0.9 * I if st_ == 0 else 0.72 * I, 0.04))
            for st_ in (4, 12):
                E("snare", at(st_, False), hum(0.82 * I, 0.04), d=0.3, pan=0.04)
            ghosts = {7: 0.17, 9: 0.11, 15: 0.19}
            if var % 2 == 1:
                ghosts[1] = 0.09
            if fill8:
                ghosts.update({13: 0.22, 14: 0.3, 15: 0.38})
            if fill16:
                ghosts = {7: 0.17, 9: 0.2, 10: 0.24, 11: 0.28, 13: 0.33, 14: 0.4, 15: 0.48}
            for st_, gv in ghosts.items():
                E("snare", at(st_), hum(gv * I, 0.12), d=0.13, pan=0.04)
            for st_ in range(16):
                hv = 0.46 if st_ % 4 == 2 else (0.3 if st_ % 2 == 0 else 0.19)
                if var == 3 and st_ == 14:
                    E("ohat", at(st_), hum(0.26 * I), pan=0.22)
                else:
                    E("hat", at(st_), hum(hv * I, 0.1), pan=0.22)
            if k == "climax":
                for st_ in (0, 4, 8, 12):
                    E("ride", at(st_, False), hum(0.34 if st_ % 8 == 0 else 0.26, 0.08), pan=-0.3)
        elif k in ("introH", "breath", "outH"):
            fade = 1.0
            kick_on, snare_on = True, True
            if k == "introH":
                if rel < 4:
                    kick_on = snare_on = False
                    fade = (rel + 1) / 5
                elif rel < 8:
                    kick_on = False
                fade *= 0.82
            if k == "breath":
                fade = 0.8
                kick_on = rel % 4 == 0
            if k == "outH":
                fade = 0.9
                if rel >= 24:
                    kick_on = False
                    snare_on = rel % 2 == 0 and rel < 30
                    fade = 0.9 * (32 - rel) / 9
            if kick_on:
                E("kick", at(0, False), hum(0.82 * fade, 0.04))
                if rel % 2 == 1:
                    E("kick", at(11, False), hum(0.5 * fade, 0.05))
            if snare_on:
                E("snare", at(8, False), hum(0.74 * max(fade, 0.6), 0.04), d=0.3, pan=0.04)
                for st_, gv in ((3, 0.09), (14, 0.12)) + (((15, 0.15),) if rel % 2 else ()):
                    E("snare", at(st_), hum(gv * max(fade, 0.6), 0.12), d=0.13, pan=0.04)
            for st_ in range(0, 16, 2):
                hv = 0.4 if st_ % 4 == 2 else 0.24
                E("hat", at(st_), hum(hv * fade, 0.1), pan=0.22)
            for st_ in (7, 15):
                E("hat", at(st_), hum(0.12 * fade, 0.1), pan=0.22)
        elif k == "rise":
            for st_ in range(16):
                ramp = (rel * 16 + st_) / 48
                E("hat", at(st_), hum((0.14 + 0.3 * ramp) * (1.0 if st_ % 2 == 0 else 0.7), 0.08), pan=0.22)
            if rel == 2:
                for st_ in range(0, 16, 2):
                    E("snare", at(st_, False), hum(0.14 + 0.36 * st_ / 14, 0.05), d=0.15, pan=0.04)
            if rel == 0:
                E("riser", t0, 0.5, d=3 * BAR)

        # ── 베이스 ──
        ch = chord_at(bar)
        R = CH[ch][0]
        if k in ("full", "fullB", "fullC", "climax"):
            pat = ([(0, 0, 5, 0.9), (6, 0, 3, 0.68), (10, 0, 4, 0.8), (14, 12, 2, 0.45)] if rel % 2 == 0 else
                   [(0, 0, 5, 0.88), (6, 0, 2, 0.62), (8, 7, 2, 0.55), (10, 0, 6, 0.8)])
            for st_, iv, ln, bv in pat:
                E("bass", at(st_, False), hum(bv, 0.03), m=R + iv, d=ln * ST * 0.94)
        elif (k == "introH" and rel >= 8) or k in ("breath", "outH", "rise"):
            if (k != "rise" and rel % 2 == 0) or (k == "rise" and rel in (0, 2)):
                ln = (1 if (k == "rise" and rel == 2) else 2) * 16 - 1
                bv = 0.8
                if k == "introH":
                    bv = 0.62 + 0.18 * (rel - 8) / 8
                if k == "outH" and rel >= 24:
                    bv = 0.8 * (32 - rel) / 9
                E("bass", at(0, False), bv, m=R, d=ln * ST)

        # ── 플루트 · 벨 ──
        def phrase(ph, ins, vv, tr=0, upto=32):
            for bt, m, ln in ph:
                if bt >= upto:
                    continue
                E(ins, t0 + bt * BEAT + hrng.normal(0, 0.003), hum(vv, 0.05), m=m + tr, d=ln * BEAT * 0.94,
                  pan=-0.18 if ins == "flute" else 0.28)

        if k == "fullB" and rel in (0, 8):
            phrase(PH_A if rel == 0 else PH_B, "flute", 0.42)
        if k == "fullC":
            if rel in (0, 8):
                phrase(PH_A if rel == 0 else PH_B, "flute", 0.48)
                if rel == 8:
                    phrase(PH_B, "bell", 0.16, tr=12)
        if k == "climax":
            cyc, r8 = divmod(rel, 8)
            if r8 == 0 and cyc < 6:
                phrase(PH_C, "flute", 0.58)
                if cyc >= 2:
                    phrase(PH_C, "bell", 0.2, tr=12)
                if cyc >= 4:
                    phrase(PH_C, "flute", 0.26, tr=-12)
            if rel == 48:
                phrase(PH_END, "flute", 0.55)
                phrase(PH_END, "bell", 0.16, tr=12)
        if k == "outH":
            if rel == 0:
                phrase(PH_A, "bell", 0.34)
            if rel == 8:
                phrase(PH_B, "flute", 0.34)
            if rel == 16:
                phrase(PH_A, "bell", 0.28, upto=16)

    # 화음 묶음 단위: 패드 · EP · 성긴 벨
    for b0, nb, ch in chord_blocks():
        s, rel = sec_of(b0)
        k = s["kind"]
        t0 = tb(b0)
        notes = CH[ch][1]
        for i, m in enumerate(notes):
            E("pad", t0, 0.12, m=m, d=nb * BAR, pan=-0.45 + 0.9 * i / (len(notes) - 1))
        if k in ("pad", "padEnd", "climax"):
            E("pad", t0, 0.06, m=notes[-1] + 12, d=nb * BAR, pan=0.35)
        ep = notes[1:]
        if k in ("full", "fullB", "fullC", "climax") and nb == 2:
            for bo, st_, ln, ev_ in [(0, 0, 6, 0.5), (0, 10, 5, 0.36), (1, 4, 4, 0.4), (1, 10, 6, 0.34)]:
                tt = t0 + bo * BAR + st_ * ST + (SW if st_ % 2 else 0)
                for j, m in enumerate(ep):
                    E("ep", tt + 0.006 * j, hum(ev_ * (0.9 if j == 0 else 0.75), 0.06), m=m, d=ln * ST,
                      pan=-0.3 + 0.2 * j)
        elif (k == "introH" and rel >= 8) or k in ("breath", "outH"):
            if not (k == "outH" and rel >= 24):
                for j, m in enumerate(ep):
                    E("ep", t0 + 0.012 * j, hum(0.34, 0.05), m=m, d=nb * BAR * 0.9, pan=-0.3 + 0.2 * j)
                E("ep", t0 + BAR + 6 * ST + SW, 0.22, m=ep[-1], d=4 * ST, pan=0.2)
        sparse = k in ("pad", "padEnd") or (k == "introH" and rel < 8) or (k == "outH" and rel >= 24) or \
            (k == "fullC" and rel >= 16)
        if sparse:
            pos = [0, 1.5, 3, 4.5, 6] if nb == 2 else [0, 1.5, 3]
            sel = sorted(hrng.choice(len(pos), size=2, replace=False))
            for q in sel:
                m = int(hrng.choice(notes[2:])) + 12
                E("bell", t0 + pos[q] * BEAT, hum(0.3 if k in ("pad", "padEnd") else 0.2, 0.1), m=m, d=1.5 * BEAT, pan=float(hrng.uniform(-0.4, 0.4)))

    for b, v in ((24, 0.42), (56, 0.36), (80, 0.4), (107, 0.7), (131, 0.42), (159, 0.45)):
        E("crash", tb(b), v, pan=0.25)
    ev.sort(key=lambda e: (e["t"], e["ins"], e["m"]))
    return ev


# ───────────────────────── 악기 ─────────────────────────

def ins_kick(v):
    # 둥근 킥: 135 → 48 Hz, 빠른 피치 하강, 1.5ms 어택(클릭 없음), 꼬리 τ 0.17
    n = int(0.6 * SR)
    t = _t(n)
    f = 48 + (135 - 48) * np.exp(-t / 0.032)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.minimum(t / 0.0015, 1) * np.exp(-t / 0.17)
    y = np.tanh(1.3 * np.sin(ph)) / np.tanh(1.3)
    return _fade_tail(y * e * v).astype(F32)


def ins_snare_body(v):
    n = int(0.35 * SR)
    t = _t(n)
    f = 182 + 50 * np.exp(-t / 0.015)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.minimum(t / 0.002, 1) * np.exp(-t / 0.055)
    return _fade_tail((np.sin(ph) + 0.3 * np.sin(1.6 * ph)) * e * v).astype(F32)


def ins_noise(v, dur, att):
    """선형 어택 → τ=dur/3 감쇠 잡음. 대역은 버스에서 한꺼번에 거른다."""
    n = int((att + dur * 1.7) * SR) + 32
    t = _t(n)
    e = np.where(t < att, t / att, np.exp(-(t - att) / (dur / 3)))
    return _fade_tail(rng.standard_normal(n) * e * v).astype(F32)


def ins_riser(v, dur):
    n = int(dur * SR)
    t = _t(n) / dur
    e = (t ** 2.2) * np.minimum(1.0, (1 - t) / 0.02)
    return (rng.standard_normal(n) * e * v).astype(F32)


def ins_ride(v):
    n = int(1.4 * SR)
    t = _t(n)
    y = np.zeros(n)
    # 음정감이 남지 않도록 비조화 부분음을 짧게, 몸통은 감쇠 잡음(버스에서 대역 제한)
    for fr, a, tau in ((2310, 0.5, 0.22), (3170, 0.3, 0.18), (4420, 0.16, 0.12), (1530, 0.15, 0.15), (2747, 0.3, 0.2)):
        y += a * np.sin(2 * np.pi * fr * (1 + 0.004 * rng.standard_normal()) * t + rng.random() * 6.283) * np.exp(-t / tau)
    y += 0.5 * rng.standard_normal(n) * (0.6 * np.exp(-t / 0.03) + 0.4 * np.exp(-t / 0.35))
    y *= np.minimum(t / 0.0015, 1)
    return _fade_tail(y * v * 0.5).astype(F32)


def ins_sub(f, dur, v):
    rel = 0.07
    n = int((dur + rel * 6) * SR)
    t = _t(n)
    y = np.sin(2 * np.pi * f * t) + 0.08 * np.sin(4 * np.pi * f * t)
    env = env_target(t, 0.012, v, 0.6, 0.85, dur, rel)
    return _fade_tail(y * env).astype(F32)


def ins_reese(f, dur, v):
    # 리스: 어긋난 톱니 두 개(채널마다 다른 어긋남) — 버스에서 300～600 Hz 로 둥글게 깎는다
    rel = 0.08
    n = int((dur + rel * 6) * SR)
    t = _t(n)
    env = env_target(t, 0.015, v, 0.5, 0.8, dur, rel)
    out = np.zeros((2, n))
    for ch, cents in enumerate(((-11.0, 6.0), (-6.0, 12.0))):
        s = np.zeros(n)
        for c in cents:
            s += polyblep_saw(f * 2 ** (c / 1200), n, 0.25 * ch + 0.1 * (c > 0))
        out[ch] = s * env * 0.5
    return _fade_tail_st(out).astype(F32)


def ins_pad(f, dur, v):
    att, rel = 0.9, 1.6
    n = int((dur + rel * 4) * SR)
    t = _t(n)
    env = env_target(t, min(att, dur * 0.5), v, 3.0, 0.9, dur, rel)
    out = np.zeros((2, n))
    for ch, cents in enumerate(((-9.0, 0.0, 7.0), (-5.0, 3.0, 10.0))):
        s = np.zeros(n)
        for c in cents:
            s += polyblep_saw(f * 2 ** (c / 1200), n, rng.random())
        out[ch] = s * env / 3
    return _fade_tail_st(out).astype(F32)


def ins_ep(f, dur, v):
    # FM 일렉트릭 피아노(music.js ep: 변조기 배율 1, 지수가 빨리 줄어 처음만 밝다)
    rel = 0.28
    n = int((dur + rel * 5) * SR)
    t = _t(n)
    I = 1.3 * np.exp(-t / 0.2) + 0.18
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * t))
    y += 0.06 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.15)
    env = env_target(t, 0.004, v, 1.0, 0.35, dur, rel)
    return _fade_tail(y * env).astype(F32)


def ins_flute(f, dur, v):
    att, rel = 0.07, 0.16
    n = int((dur + rel * 5) * SR)
    t = _t(n)
    vib = 1 + 0.0045 * np.sin(2 * np.pi * 5.1 * t) * np.clip((t - 0.22) / 0.3, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    y = np.sin(ph) + 0.26 * np.sin(2 * ph) + 0.09 * np.sin(3 * ph) + 0.03 * np.sin(4 * ph)
    env = env_target(t, att, v, 0.8, 0.82, dur, rel)
    br = rng.standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    br = np.fft.irfft(np.fft.rfft(br) * hp_mag(fr, 900, 1) * lp_mag(fr, 3500, 2), n=n)
    y = y + 0.07 * br * (1 + 1.5 * np.exp(-t / 0.06))
    return _fade_tail(y * env).astype(F32)


def ins_bell(f, dur, v):
    n = int(3.0 * SR)
    t = _t(n)
    I = 1.1 * np.exp(-t / 0.18) + 0.08
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * 2 * f * t))
    y += 0.12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / 0.35)
    e = np.minimum(t / 0.004, 1) * np.exp(-t / 0.9)
    return _fade_tail(y * e * v).astype(F32)

# ───────────────────────── 이펙트 (compose_city.py ← compose.py 에서 복사) ─────────────────────────

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


# ───────────────────────── 측정·마스터링 (compose_city.py ← compose.py 에서 복사) ─────────────────────────

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


def _fast_len(n):
    """n 이상인 2·3·5 매끄러운 수(FFT 가 빠른 길이)."""
    best = 1 << (n - 1).bit_length()
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            m = p35
            while m < n:
                m *= 2
            best = min(best, m)
            p35 *= 3
        p5 *= 5
    return best


def loudness(x):
    """통합 라우드니스(LUFS 근사, 게이트 포함). x:(2,n), n 은 임의."""
    n = x.shape[1]
    nf = n if n == N else _fast_len(n)        # 구간 측정은 빠른 FFT 길이로 0 채움(전체 곡은 원형 그대로)
    fr = np.fft.rfftfreq(nf, 1 / SR)
    kw = np.fft.irfft(np.fft.rfft(x.astype(np.float64), n=nf, axis=1) * k_weight_mag(fr), n=nf, axis=1)[:, :n]
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
    k = (ins, m, round(d, 5))
    if k not in _SYN:
        _SYN[k] = fn(mtof(m), d, 1.0)
    return _SYN[k]


def render_bus(events, names, fn):
    bus = new_bus()
    for e in events:
        if e["ins"] in names:
            add(bus, e["t"], fn(e), e["pan"])
    return bus


def lfo(cycles, phase=0.0):
    """300초에 정수 주기인 사인 LFO(루프 연속)."""
    t = np.arange(N, dtype=np.float64) / N
    return np.sin(2 * np.pi * (cycles * t + phase)).astype(F32)


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

    def put(name, bus, g, rev=0.0, echo=0.0):
        nonlocal mix, rev_send, echo_send
        if g != 1.0:
            bus *= F32(g)
        stems[name] = bus_rms_rows(bus)
        mix += bus
        if rev:
            rev_send += F32(rev) * bus
        if echo:
            echo_send += F32(echo) * bus

    # 킥 + 사이드체인 트리거
    kb = new_bus()
    trig = np.zeros(N, dtype=F32)
    for e in events:
        if e["ins"] == "kick":
            add(kb, e["t"], ins_kick(e["v"]))
            trig[int(round(e["t"] * SR)) % N] += e["v"]
    duck = sidechain(trig, depth=1.0)          # 0(킥 순간)～1 사이 곡선 → 갈래마다 깊이를 따로 준다
    del trig
    kb = fd_filter(kb, hp_mag(f, 30, 2) * lp_mag(f, 2200, 2))
    put("kick", kb, 0.95, rev=0.03)
    del kb
    st("kick")

    sn = new_bus()
    snn = new_bus()
    for e in events:
        if e["ins"] == "snare":
            add(sn, e["t"], ins_snare_body(e["v"]), e["pan"])
            add(snn, e["t"], ins_noise(e["v"], e["d"], 0.0015), e["pan"])
    sn = fd_filter(sn, hp_mag(f, 120, 2) * lp_mag(f, 1800, 2))
    soft = shelf_hi(f, 6000, -4.0) * lp_mag(f, 10000, 2)    # 드럼 노이즈 공통: 6kHz 위 −4 dB 셸프 + 10kHz 로우패스
    snn = fd_filter(snn, hp_mag(f, 650, 2) * lp_mag(f, 4800, 2) * soft)
    sn += 0.55 * snn
    del snn
    put("snare", sn, 0.88, rev=0.32)
    del sn
    st("snare")

    hb = render_bus(events, {"hat", "ohat"},
                    lambda e: ins_noise(e["v"], 0.055 if e["ins"] == "hat" else 0.45, 0.0012))
    hb = fd_filter(hb, hp_mag(f, 3800, 2) * lp_mag(f, 7200, 3) * soft)
    put("hat", hb, 0.68, rev=0.18)
    del hb
    rb = render_bus(events, {"ride"}, lambda e: ins_ride(e["v"]))
    rb = fd_filter(rb, hp_mag(f, 900, 1) * lp_mag(f, 6500, 3) * soft)
    put("ride", rb, 0.35, rev=0.25)
    del rb
    fx = render_bus(events, {"crash"}, lambda e: ins_noise(e["v"], 6.0, 0.012))
    for e in events:
        if e["ins"] == "riser":
            add(fx, e["t"], ins_riser(e["v"], e["d"]), 0.0)
    fx = fd_filter(fx, hp_mag(f, 450, 2) * lp_mag(f, 4500, 2) * soft)
    del soft
    put("crash·riser", fx, 0.16, rev=0.5)
    del fx
    st("hat·ride·fx")

    # 밝기: 인트로·결은 어둡게, 클라이맥스에서 가장 밝게(처음·끝 같은 값 → 루프 연속)
    bright = automation([(0, 0.22), (24, 0.5), (56, 0.6), (72, 0.38), (80, 0.65), (104, 0.75), (107, 1.0),
                         (155, 0.9), (159, 0.5), (191, 0.28), (215, 0.22)])

    bs = render_bus(events, {"bass"}, lambda e: cached("sub", e["m"], e["d"], ins_sub) * F32(e["v"]))
    bs = fd_filter(bs, hp_mag(f, 26, 2) * lp_mag(f, 160, 2))
    bs *= (0.45 + 0.55 * duck)[None, :]
    put("sub", bs, 0.36)
    del bs
    rz = render_bus(events, {"bass"}, lambda e: cached("reese", e["m"], e["d"], ins_reese) * F32(e["v"]))
    move = (0.5 + 0.5 * lfo(27)) * (0.35 + 0.65 * bright)
    rz = fd_split(rz, hp_mag(f, 80, 2) * lp_mag(f, 240, 2), hp_mag(f, 80, 2) * lp_mag(f, 620, 2), move)
    del move
    rz *= (0.55 + 0.45 * duck)[None, :]
    put("reese", rz, 0.22, rev=0.04)
    del rz
    st("bass")

    pb = new_bus()
    for e in events:
        if e["ins"] == "pad":
            sig = cached("pad", e["m"], e["d"], ins_pad) * F32(e["v"])
            gl_, gr_ = pan_gains(e["pan"])
            sig[0] *= gl_ * 1.41
            sig[1] *= gr_ * 1.41
            add(pb, e["t"], sig)
    hp = hp_mag(f, 140, 1)
    pb = fd_split(pb, hp * lp_mag(f, 900, 2), hp * lp_mag(f, 2600, 2), bright)
    pb *= automation([(0, 1.7), (8, 1.25), (24, 0.72), (72, 0.95), (80, 0.68), (104, 1.0), (107, 0.8), (159, 0.85),
                      (183, 0.95), (193, 1.7), (215, 1.7)])[None, :]
    pb *= (0.62 + 0.38 * duck)[None, :]
    put("pad", pb, 0.85, rev=0.6)
    del pb
    st("pad")

    eb = render_bus(events, {"ep"}, lambda e: cached("ep", e["m"], e["d"], ins_ep) * F32(e["v"]))
    eb = fd_split(eb, hp_mag(f, 160, 1) * lp_mag(f, 2200, 2), hp_mag(f, 160, 1) * lp_mag(f, 4500, 1), bright)
    trem = lfo(BARS * 2)                      # 2박 주기 자동 패닝 트레몰로
    eb[0] *= 1 + 0.16 * trem
    eb[1] *= 1 - 0.16 * trem
    del trem
    eb *= (0.7 + 0.3 * duck)[None, :]
    put("ep", eb, 0.56, rev=0.4, echo=0.12)
    del eb
    st("ep")

    LFN = {"flute": (ins_flute, 1.0), "bell": (ins_bell, 1.0)}
    lb = render_bus(events, set(LFN), lambda e: cached(e["ins"], e["m"], e["d"], LFN[e["ins"]][0])
                    * F32(e["v"] * LFN[e["ins"]][1]))
    hp = hp_mag(f, 200, 1)
    lb = fd_split(lb, hp * lp_mag(f, 3000, 2), hp * lp_mag(f, 5500, 2), bright)
    put("flute·bell", lb, 0.42, rev=0.5, echo=0.32)
    del lb
    del duck
    st("lead")

    echo = circ_conv(echo_send.mean(axis=0), echo_ir(0.75, 0.36, 7))
    del echo_send
    mix += 0.42 * echo
    rev_send += 0.35 * echo
    del echo
    st("echo")
    wet = circ_conv(rev_send, reverb_ir(3.8, 3.0, 1.2))
    del rev_send
    wet = fd_filter(wet, hp_mag(f, 160, 1) * lp_mag(f, 6000, 1))
    mix += 0.3 * wet
    del wet
    st("reverb")

    # 초저역 정리 + 9kHz 위를 완만히 눌러 날카로움 방지
    mix = fd_filter(mix, hp_mag(f, 25, 2) * lp_mag(f, 9500, 1))

    lufs0 = loudness(mix)
    gain = F32(10 ** ((TARGET_LUFS - lufs0) / 20))
    mix *= gain
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
    for _ in range(3):
        l1 = loudness(mix)
        if abs(l1 - TARGET_LUFS) < 0.15:
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


def bus_rms_rows(x):
    bounds = [s for _, s in SECTIONS] + [BARS]
    row = []
    for k in range(len(SECTIONS)):
        seg = x[:, int(tb(bounds[k]) * SR):int(tb(bounds[k + 1]) * SR)].astype(np.float64)
        row.append(20 * math.log10(max(math.sqrt(float((seg ** 2).mean())), 1e-9)))
    return row

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



def hf_ratio(seg, cut=8000.0):
    """cut Hz 이상 에너지 / 전체 에너지 (dB)."""
    mono = seg.mean(axis=0).astype(np.float64)
    nfft = 8192
    nfr = len(mono) // nfft
    P = np.zeros(nfft // 2 + 1)
    win = np.hanning(nfft)
    for i in range(0, nfr, 256):
        fr_ = mono[i * nfft:min(nfr, i + 256) * nfft].reshape(-1, nfft) * win[None, :]
        P += (np.abs(np.fft.rfft(fr_, axis=1)) ** 2).sum(axis=0)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    return 10 * math.log10(max(P[fr >= cut].sum() / P.sum(), 1e-15))


def crest(seg):
    """15초 창 평균 크레스트 팩터(dB) — 트랜지언트 세기 참고치."""
    a = np.abs(seg).max(axis=0).astype(np.float64)
    w = 15 * SR
    out = []
    for i in range(0, a.shape[0] - w + 1, w):
        blk = seg[:, i:i + w].astype(np.float64)
        out.append(db(float(a[i:i + w].max())) - db(math.sqrt(float((blk ** 2).mean()))))
    return float(np.mean(out))


def analyze(x, log=print):
    res = {"sections": [], "sub": [], "windows": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    log("\n구간별 에너지")
    log("  구간  시간          RMS(dBFS)  피크(dBFS)  LUFS(근사)  중심(Hz)  8k+(dB)")
    for k, (name, b0) in enumerate(SECTIONS):
        t0, t1 = tb(b0), tb(bounds[k + 1])
        seg = x[:, int(t0 * SR):int(t1 * SR)]
        seg64 = seg.astype(np.float64)
        row = dict(name=name, t0=t0, t1=t1, bars=(b0, bounds[k + 1] - 1),
                   rms=db(math.sqrt(float((seg64 ** 2).mean()))), peak=db(float(np.abs(seg).max())),
                   lufs=loudness(seg), cent=centroid(seg), hf=hf_ratio(seg))
        del seg64
        res["sections"].append(row)
        log(f"  {name}    {mmss(t0)}～{mmss(t1)}    {row['rms']:7.2f}   {row['peak']:8.2f}   {row['lufs']:8.2f}"
            f"   {row['cent']:7.0f}   {row['hf']:6.1f}")
    for s in SECS:
        b0 = SEC_START[s["n"]]
        seg = x[:, int(tb(b0) * SR):int(tb(b0 + s["bars"]) * SR)]
        res["sub"].append(dict(name=s["n"], b0=b0, b1=b0 + s["bars"] - 1, t0=tb(b0), t1=tb(b0 + s["bars"]),
                               rms=db(math.sqrt(float((seg.astype(np.float64) ** 2).mean()))),
                               lufs=loudness(seg), cent=centroid(seg)))
    res["total_rms"] = db(math.sqrt(float((x.astype(np.float64) ** 2).mean())))
    res["peak"] = db(float(np.abs(x).max()))
    res["lufs"] = loudness(x)
    res["true_peak"] = db(true_peak(x))
    res["cent"] = centroid(x)
    res["hf"] = hf_ratio(x)
    res["crest"] = crest(x)
    log(f"  전체  0:00～5:00    {res['total_rms']:7.2f}   {res['peak']:8.2f}   {res['lufs']:8.2f}   {res['cent']:7.0f}"
        f"   {res['hf']:6.1f}   (트루피크 근사 {res['true_peak']:.2f} dBTP, 크레스트 {res['crest']:.1f} dB)")
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
                       lufs_end=loudness(x[:, -10 * SR:]), lufs_start=loudness(x[:, :10 * SR]))
    s = res["seam"]
    log(f"\n루프 이음매: 끝 50ms RMS {s['end50']:.2f} dBFS, 처음 50ms RMS {s['start50']:.2f} dBFS, "
        f"경계 샘플 차 {jump:.5f} (전형적 인접 샘플 차 최대 {typ:.5f}), 끝/처음 10초 LUFS {s['lufs_end']:.2f}/{s['lufs_start']:.2f}")
    return res


def spectrogram_png(x, path, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    mono = x.mean(axis=0).astype(np.float32)
    nfft, hop = 4096, 2048
    nfr = (len(mono) - nfft) // hop + 1
    win = np.hanning(nfft).astype(np.float32)
    fr_lin = np.fft.rfftfreq(nfft, 1 / SR)
    fr = np.geomspace(30, 16000, 320)              # 로그 간격 320칸으로 줄여 그린다
    edges = np.searchsorted(fr_lin, np.sqrt(fr[:-1] * fr[1:]))
    edges = np.concatenate([[np.searchsorted(fr_lin, 30)], edges, [np.searchsorted(fr_lin, 16000)]])
    lo, hi = edges[:-1], np.maximum(edges[1:], edges[:-1] + 1)
    S = np.empty((nfr, len(fr)), dtype=np.float32)
    for i in range(0, nfr, 512):
        j = min(nfr, i + 512)
        idx = np.arange(nfft)[None, :] + hop * np.arange(i, j)[:, None]
        P = np.abs(np.fft.rfft(mono[idx] * win, axis=1)).astype(np.float32) ** 2
        cs = np.concatenate([np.zeros((P.shape[0], 1), np.float32), np.cumsum(P, axis=1)], axis=1)
        S[i:j] = np.sqrt((cs[:, hi] - cs[:, lo]) / (hi - lo))
    Sdb = 20 * np.log10(S.T + 1e-7)
    tt = (np.arange(nfr) * hop + nfft / 2) / SR
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 7.5), sharex=True, gridspec_kw={"height_ratios": [3, 1.2]})
    vmax = float(Sdb.max())
    ax1.pcolormesh(tt[::2], fr, Sdb[:, ::2], shading="auto", cmap="magma", vmin=vmax - 80, vmax=vmax)
    ax1.set_yscale("log")
    ax1.set_ylim(30, 16000)
    ax1.axhline(8000, color="#7fd3ff", lw=0.7, ls=":", alpha=0.8)
    ax1.set_ylabel("주파수 (Hz)")
    ax1.set_title(f"{TITLE} — 스펙트로그램 (모노 합, {BPM} BPM, 300초, 점선 8 kHz)")
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
        ax1.text(tb(b) + 2, 14000, name, color="white", fontsize=12, va="top")
    for ax in (ax1, ax2):
        ax.axvspan(tb(107), tb(159), color="#ffd27f", alpha=0.07 if ax is ax1 else 0.15)
    ax1.set_xlim(0, DUR)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


DESC = {
    "인트로 패드": "Fm9 패드(필터 닫힘)·성긴 FM 벨, 비트 없음",
    "인트로 하프타임": "셔플 햇 페이드인 → 하프타임 스네어(3박) → 둥근 킥, 8마디부터 서브 긴 음·EP 화음",
    "풀 템포 A": "투스텝 브레이크비트(킥 1·2.5박, 스네어 2·4박, 고스트·16분 셔플 햇), 롤링 서브+리스, EP 컴핑",
    "풀 템포 B · 모티프 예고": "플루트 모티프 A·B 첫 등장, 드럼 세기 조금 올림",
    "숨 고르기(하프타임)": "하프타임 드럼(킥 성기게)·서브 긴 음·EP 화음, 패드 앞으로",
    "풀 템포 C": "풀 템포 복귀, 플루트 A·B(B 는 벨 옥타브 겹침), 끝 8마디 벨 점묘",
    "상승": "킥 빠짐, 16분 햇·8분 스네어 크레셴도, 노이즈 상승, Dbmaj9–Eb9sus4",
    "클라이맥스": "Dbmaj9–Eb(add9)–Cm11–Fm9, 플루트 모티프 C ×6(3회째부터 벨 옥타브, 5회째부터 낮은 플루트), 라이드 4분, 필터 최대",
    "하프타임 정리": "하프타임 드럼, 벨 모티프 A 회상 → 플루트 B, 마지막 8마디 킥 빠지고 햇·베이스 페이드",
    "패드 귀결": "패드·벨만, 필터 닫힘 → 마지막 Eb9sus4 에서 처음 Fm9 로 이어짐(루프)",
}


def write_report(path, res, stem_rms, mp3_info, gr, elapsed):
    L = []
    L.append(f"# {TITLE} — 작업 배경음악 합성 보고 (활동 단계 {STAGE})\n")
    L.append(f"- 생성: `compose_liquid.py` (seed {SEED}, numpy {np.__version__}), 실행 시간 {elapsed:.0f}초")
    L.append(f"- 형식: {SR} Hz 스테레오, {BITRATE} kbps CBR MP3, {BPM} BPM 4/4, {BARS}마디 = {DUR:.1f}초, {KEY_NAME}")
    L.append("- 장르: 리퀴드 드럼앤베이스. 외부 샘플·실존 곡 인용 없음(선율·화성·리듬 모두 스크립트 안에서 정의). "
             "악기 아이디어(FM EP, 사인 플루트, 서브)는 이전 프로젝트 `music.js` 악기 정의를 참고\n")
    L.append("## 곡 구조\n")
    L.append("| 큰 구간 | 세부 구간 | 시간 | 마디 | 화음 | 편성 |")
    L.append("|---|---|---|---|---|---|")
    for s in SECS:
        b0 = SEC_START[s["n"]]
        seen = []
        for b in range(b0, b0 + s["bars"]):
            c = chord_at(b)
            if c not in seen:
                seen.append(c)
        L.append(f"| {s['big']} | {s['n']} | {mmss(tb(b0))}～{mmss(tb(b0 + s['bars']))} | {b0}～{b0 + s['bars'] - 1} | "
                 f"{'–'.join(seen)} | {DESC[s['n']]} |")
    L.append("")
    L.append("## 구간별 RMS·LUFS·스펙트럼 중심·고역 비율\n")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) | 8 kHz 이상 에너지 (dB) |")
    L.append("|---|---|---|---|---|---|---|")
    for r in res["sections"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['peak']:.2f} | {r['lufs']:.2f} | "
                 f"{r['cent']:.0f} | {r['hf']:.1f} |")
    L.append(f"| 전체 | 0:00～5:00 | {res['total_rms']:.2f} | {res['peak']:.2f} | {res['lufs']:.2f} | {res['cent']:.0f} | "
             f"{res['hf']:.1f} |")
    L.append("")
    L.append("세부 구간\n")
    L.append("| 세부 구간 | 시간 | RMS (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) |")
    L.append("|---|---|---|---|---|")
    for r in res["sub"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['lufs']:.2f} | {r['cent']:.0f} |")
    L.append("")
    L.append("악기 갈래별 RMS (마스터 이득 적용, 리버브·딜레이 제외, dBFS)\n")
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
    L.append(f"| 끝 10초 LUFS / 처음 10초 LUFS | {s['lufs_end']:.2f} / {s['lufs_start']:.2f} |")
    L.append(f"| 경계 샘플 차(끝→처음) | {s['jump']:.5f} (처음 1초 인접 샘플 차 최대 {s['typ']:.5f}) |")
    L.append(f"| 스펙트럼 중심 끝 10초 / 처음 10초 | {s['cent_end']:.0f} / {s['cent_start']:.0f} Hz |")
    L.append("| 방식 | 300초 원형 버퍼: 끝을 넘는 패드 꼬리·리버브·딜레이가 앞머리로 감김. LFO(리스 필터·EP 트레몰로)는 300초에 정수 주기. "
             "마지막 Eb9sus4 → 첫 Fm9, 양끝 모두 패드·벨만·같은 밝기(0.22)·같은 패드 레벨 |")
    L.append("| 한계 | MP3 인코더 지연·패딩(약 25～50ms)은 남으므로 `<audio loop>` 는 완전 무간격이 아님 |")
    L.append("")
    L.append("## 검사\n")
    L.append("| 항목 | 기준 | 결과 | 판정 |")
    L.append("|---|---|---|---|")
    for name, crit, val, ok in mp3_info["checks"]:
        L.append(f"| {name} | {crit} | {val} | {'통과' if ok else '실패'} |")
    L.append(f"\n리미터 최대 이득 감소 {gr:.2f} dB. 15초 창 평균 크레스트 팩터 {res['crest']:.1f} dB.\n")
    L.append("## 파일\n")
    L.append("| 파일 | 크기 | SHA-256 |")
    L.append("|---|---|---|")
    for fn, size, h in mp3_info["files"]:
        L.append(f"| `{fn}` | {size:,} bytes | `{h}` |")
    L.append(f"\nPCM(16bit) SHA-256 `{mp3_info['pcm_sha']}`. 같은 환경에서 다시 실행하면 같은 해시가 나옵니다.")
    if mp3_info.get("repro"):
        L.append(f"\n{mp3_info['repro']}")
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
    ap.add_argument("--repro", default=None, help="보고서에 덧붙일 재현성 확인 문장(선택)")
    args = ap.parse_args(argv)

    t0 = time.time()
    print(f"합성 시작: {BPM} BPM, {BARS}마디, {DUR:.0f}초, seed {SEED}")
    mix, events, stem_rms, gr = render()
    _SYN.clear()
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
        ("8 kHz 이상 에너지", "≤ −25 dB(전체 대비)", f"{res['hf']:.1f} dB", res["hf"] <= -25.0),
        ("PCM 길이", "정확히 300초", f"{pcm.shape[1]} 샘플 = {pcm.shape[1]/SR:.3f}초", pcm.shape[1] == N),
    ]
    ok = all(c[3] for c in checks)
    elapsed = time.time() - t0
    me = os.path.abspath(__file__)
    files = [(os.path.basename(out), len(mp3), mp3_sha), (os.path.basename(jpath), os.path.getsize(jpath), sha(jpath)),
             ("spectrogram.png", os.path.getsize(png), sha(png)),
             (os.path.basename(me), os.path.getsize(me), sha(me))]
    write_report(os.path.join(od, "report.md"), res, stem_rms,
                 {"checks": checks, "files": files, "pcm_sha": pcm_sha, "repro": args.repro}, gr, elapsed)
    for c in checks:
        print(f"  {c[0]}: {c[2]} ({c[1]}) {'통과' if c[3] else '실패'}")
    print(f"  검사: {'통과' if ok else '실패'}  (실행 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
