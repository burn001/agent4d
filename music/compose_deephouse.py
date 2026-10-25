#!/usr/bin/env python3
"""'흐르는 라인' 작업 배경음악 결정적 합성기 (활동 단계 2 · 활발, 소프트 딥하우스).

120 BPM, 4/4, 150마디 = 정확히 300초, A minor(에올리안·도리안 색). 외부 샘플 없이 numpy 로 전부 합성한다.
마스터링·원형 루프·검사·MP3 부분은 music/compose_city.py(← compose.py)를 복사해 재사용했다.

구조:
  인트로       0:00～0:32  (마디   0～15)  둥근 킥(작게) + 로우패스 닫힌 딥 코드 스탭, 8마디부터 스윙 셰이커
  빌드         0:32～1:36  (마디  16～47)  서브 베이스(16)·오프비트 오픈햇(24)·클랩·패드(32), 필터 열림
  그루브       1:36～2:30  (마디  48～74)  풀 그루브, 72～74 전환(필터 잠깐 닫힘·노이즈 상승·74마디 킥 쉼)
  클라이맥스   2:30～3:40  (마디  75～109) 진행 전환 Dm9–Em11–Fmaj9–G6/9, 필터 최대, 로즈풍 건반 선율
  브레이크다운 3:40～4:12  (마디 110～125) 킥·베이스 빠짐, 패드·긴 스탭, 서브 스웰, 노이즈 상승
  아웃트로     4:12～5:00  (마디 126～149) 킥·베이스 복귀 후 하나씩 빠지며 필터 닫힘 → 인트로와 같은 상태로 루프

루프: 모든 꼬리·리버브·딜레이는 300초 원형 버퍼로 앞머리에 감긴다. 마지막 화음 Em11 → 첫 화음 Am9.

사용법:
  python compose_deephouse.py --out bgm-deephouse.mp3 [--wav 미리듣기.wav]
  (같은 폴더에 bgm-deephouse.json, report.md, spectrogram.png 도 만든다)
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


SEED = 2122
SR = 44100
BPM = 120
BEAT = 60.0 / BPM            # 0.5 s
ST = BEAT / 4                # 16분음표 0.125 s
BAR = 4 * BEAT               # 2.0 s
BARS = 150
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -1.5               # 샘플 피크 상한
BITRATE = 128
SWING = 0.13                 # 홀수 16분을 16분의 13% 늦춤(≈56.5% 스윙)
SECTIONS = [("인트로", 0), ("빌드", 16), ("그루브", 48), ("클라이맥스", 75), ("브레이크다운", 110), ("아웃트로", 126)]
TITLE = "흐르는 라인"
MOOD = "꾸준히 흐르는 활발한 작업 리듬 — 소프트 딥하우스, 둥근 킥, 어두운 오프비트 햇, 스윙 셰이커, 마이너 9·11 코드 스탭, 따뜻한 서브 베이스"
STAGE = 2
ENERGY = 0.62
KEY_NAME = "A minor"

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "bgm-deephouse.mp3")

rng = np.random.default_rng(SEED)
F32 = np.float32


# ───────────────────────── 기본 유틸 (compose.py 에서 복사) ─────────────────────────

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



def ts(bar: float, step: float) -> float:
    """마디·16분 스텝 → 초. 홀수 16분은 SWING 만큼 늦춘다."""
    s = int(step)
    return bar * BAR + (step + (SWING if s % 2 else 0.0)) * ST


def log_automation(points):
    """[(bar, Hz)] 를 로그 영역 선형 보간한 함수(bar → Hz)."""
    xs = np.array([p[0] for p in points], dtype=np.float64)
    ys = np.log(np.array([p[1] for p in points], dtype=np.float64))
    return lambda b: float(np.exp(np.interp(b, xs, ys)))


# ───────────────────────── 화음 ─────────────────────────

CH = {"Am9": (9, "m9"), "Am11": (9, "m11"), "Dm9": (2, "m9"), "Dm11": (2, "m11"), "Em11": (4, "m11"),
      "Fmaj9": (5, "maj9"), "G69": (7, "69")}
QI = {"m9": [0, 3, 7, 10, 14], "m11": [0, 3, 10, 14, 17], "maj9": [0, 4, 7, 11, 14], "69": [0, 4, 7, 9, 14]}
PA = ["Am9", "Am9", "Dm11", "Dm11", "Am9", "Am9", "Fmaj9", "Em11"]          # 인트로·빌드·그루브·브레이크다운·아웃트로
PB = ["Dm9", "Dm9", "Em11", "Em11", "Fmaj9", "Fmaj9", "G69", "G69"]        # 클라이맥스(근음 D–E–F–G 상행)
PT = {72: "Fmaj9", 73: "Fmaj9", 74: "Em11", 107: "Fmaj9", 108: "Fmaj9", 109: "Em11"}


def chord_at(b):
    if b in PT:
        return PT[b]
    if 75 <= b < 107:
        return PB[(b - 75) % 8]
    if b >= 126:
        return PA[(b - 126) % 8]
    if b >= 110:
        return PA[(b - 110) % 8]
    return PA[b % 8]


def voicing(name):
    pc, q = CH[name]
    root = 48 + pc
    out = []
    for iv in QI[q]:
        m = root + iv
        while m > 74:
            m -= 12
        while m < 50:
            m += 12
        out.append(m)
    return tuple(sorted(set(out)))


def bass_root(name):
    return 33 + (CH[name][0] - 9) % 12          # A1(55Hz)～G#2


def is_minor(name):
    return CH[name][1].startswith("m") and not CH[name][1].startswith("maj")


# 구간 표 (큰 구간, 세부 이름, 시작, 끝(미포함), 설명)
SUBS = [
    ("인트로", "인트로 1", 0, 8, "둥근 킥(작게) + 딥 코드 스탭, 로우패스 닫힘(약 380Hz)"),
    ("인트로", "인트로 2", 8, 16, "16분 스윙 셰이커 진입(작게), 필터 조금씩 열림"),
    ("빌드", "빌드 1", 16, 24, "서브 베이스 오프비트 그루브 진입, 약한 사이드체인"),
    ("빌드", "빌드 2", 24, 32, "어두운 오프비트 오픈햇 진입(6.5kHz 위 차단)"),
    ("빌드", "빌드 3", 32, 48, "2·4박 부드러운 클랩, 딥 패드, 스탭 필터 약 1.8kHz 까지 열림"),
    ("그루브", "그루브", 48, 72, "풀 그루브, 스탭·베이스 변형 패턴(4마디마다)"),
    ("그루브", "전환", 72, 75, "Fmaj9–Em11, 필터 잠깐 닫혔다 열림, 노이즈 상승, 74마디 킥 쉼"),
    ("클라이맥스", "클라이맥스", 75, 107, "진행 전환 Dm9–Em11–Fmaj9–G6/9, 필터 최대(약 3.3kHz), 촘촘한 스탭, 로즈풍 건반 선율"),
    ("클라이맥스", "클라이맥스 꼬리", 107, 110, "Fmaj9–Em11, 필터 닫히기 시작, 109마디 후반 킥 빠짐"),
    ("브레이크다운", "브레이크다운", 110, 126, "킥·베이스 빠짐, 패드·긴 스탭·리버브, 118마디 셰이커·서브 스웰, 121～125 노이즈 상승"),
    ("아웃트로", "아웃트로 1", 126, 142, "킥·베이스·햇·클랩 복귀, 필터 닫혀 감, 138마디 햇·클랩 빠짐"),
    ("아웃트로", "아웃트로 2", 142, 150, "킥 + 닫힌 스탭만 → Em11 에서 처음의 Am9 로 이어짐(루프)"),
]

# 스탭 리듬 (16분 스텝, 길이 스텝)
STAB_A = [(3, 2), (6, 2), (11, 2), (14, 1)]
STAB_B = [(3, 2), (6, 2), (10, 2), (13, 1), (15, 1)]
STAB_C = [(3, 2), (6, 2), (8, 1), (11, 2), (14, 2)]
STAB_BD = [(0, 6), (6, 3), (10, 6)]
# 베이스 리듬 (스텝, 길이, 음도) — 킥 자리(0·4·8·12)는 비운다
BASS_A = [(2, 3, "r"), (7, 1, "r"), (10, 3, "r"), (14, 1, "o")]
BASS_B = [(2, 3, "r"), (7, 1, "5"), (10, 2, "r"), (13, 1, "7"), (14, 2, "o")]
BASS_C = [(2, 2, "r"), (5, 1, "o"), (7, 1, "r"), (10, 3, "r"), (14, 1, "5"), (15, 1, "o")]
# 건반 선율 리듬 (2마디 = 32스텝)
KEYS_RH = [(2, 2), (6, 3), (10, 2), (14, 5), (19, 1), (20, 2), (24, 2), (27, 5)]

STAB_FC = log_automation([(0, 380), (8, 420), (16, 560), (32, 1100), (48, 1800), (60, 2100), (71, 2200),
                          (72, 1250), (74.5, 2400), (75, 2600), (91, 3000), (103, 3300), (107, 2800),
                          (110, 1000), (118, 1300), (125, 1900), (126, 1700), (138, 900), (146, 380), (150, 380)])


def kick_on(b, beat):
    if b == 74:
        return False
    if b == 109 and beat >= 2:
        return False
    return b < 110 or b >= 126


def gen_events():
    er = np.random.default_rng(SEED + 1)
    hum = lambda s=0.06: float(1.0 + s * (er.random() * 2 - 1))
    ev = []

    def E(ins, t, v, m=0, d=0.0, pan=0.0, **kw):
        e = dict(ins=ins, t=t, v=v, m=m, d=d, pan=pan)
        e.update(kw)
        ev.append(e)

    prev_ch = None
    pad_open = None
    for b in range(BARS):
        ch = chord_at(b)
        # 킥
        kv = 0.62 if b < 16 or b >= 142 else (0.72 if b < 48 or b >= 126 else 0.8)
        for beat in range(4):
            if kick_on(b, beat):
                E("kick", ts(b, beat * 4), kv * hum(0.03))
        # 클랩 2·4박
        if 32 <= b < 107 or (126 <= b < 138):
            for beat in (1, 3):
                if b == 74:
                    continue
                E("clap", ts(b, beat * 4) + 0.004, 0.5 * hum(), pan=0.05)
        # 오픈햇 오프비트
        if 24 <= b < 109 or 126 <= b < 138:
            if b != 74:
                hv = 0.42 if b < 48 else 0.5
                for beat in range(4):
                    E("hat", ts(b, beat * 4 + 2), hv * hum(), pan=0.18)
        # 셰이커 16분 스윙
        if 8 <= b < 110 or 118 <= b < 142:
            base = 0.3 if b < 16 or b >= 118 and b < 126 else 0.42
            for s in range(16):
                acc = (1.0, 0.45, 0.7, 0.5)[s % 4]
                E("shaker", ts(b, s), base * acc * hum(0.1), pan=-0.22)
        # 스탭
        fc = STAB_FC(b)
        if 110 <= b < 126:
            pat = STAB_BD
        elif 75 <= b < 107:
            pat = STAB_C if b % 2 else STAB_A
        else:
            pat = STAB_B if b % 4 == 3 else STAB_A
        sv = 0.5 if b < 16 or b >= 142 else 0.58
        if 110 <= b < 126:
            sv = 0.42
        vc = voicing(ch)
        for k, (s, dl) in enumerate(pat):
            f_ = STAB_FC(b + s / 16)
            E("stab", ts(b, s), sv * (1.08 if k == 0 else 1.0) * hum(), d=dl * ST * 0.92, notes=vc,
              fc=float(2 ** (round(math.log2(f_) * 6) / 6)), pan=0.0)
        # 베이스
        if (16 <= b < 109) or (126 <= b < 142):
            if b == 74:
                pat_b = [(2, 3, "r"), (10, 3, "r")]
            elif 75 <= b < 107:
                pat_b = BASS_C if b % 4 == 3 else (BASS_B if b % 2 else BASS_A)
            else:
                pat_b = BASS_B if b % 4 == 3 else BASS_A
            r = bass_root(ch)
            bv = 0.7 if b < 24 else 0.85
            for s, dl, deg in pat_b:
                off = {"r": 0, "o": 12, "5": 7, "7": 10 if is_minor(ch) else 7}[deg]
                E("bass", ts(b, s), bv * hum(0.05), m=r + off, d=dl * ST * 0.9)
        elif 118 <= b < 126:
            if b % 2 == 0:
                E("bass", ts(b, 0), 0.32 + 0.05 * (b - 118), m=bass_root(ch), d=2 * BAR - 0.2)
        # 패드 (화음이 바뀔 때마다 하나)
        pad_live = (32 <= b < 138)
        if pad_live and (ch != prev_ch or pad_open is None or b == 32):
            if pad_open is not None:
                pad_open["d"] = ts(b, 0) - pad_open["t"]
            E("pad", ts(b, 0), 0.5 if not (110 <= b < 126) else 0.62, d=BAR, notes=vc)
            pad_open = ev[-1]
        elif not pad_live and pad_open is not None:
            pad_open["d"] = ts(b, 0) - pad_open["t"]
            pad_open = None
        prev_ch = ch
        # 건반 선율 (클라이맥스, 브레이크다운 후반 조각)
        if (75 <= b < 107 and (b - 75) % 2 == 0) or (b in (114, 118)):
            cyc = ((b - 75) // 8) % 2 if b < 107 else 2
            kr = np.random.default_rng(SEED * 10 + cyc + (b - 75) % 8)
            tones = sorted({m + 12 * o for m in voicing(ch) for o in (0, 1, 2) if 67 <= m + 12 * o <= 81})
            idx = len(tones) // 2
            rh = KEYS_RH if b < 107 else KEYS_RH[:4]
            for s, dl in rh:
                idx = int(np.clip(idx + kr.choice([-2, -1, -1, 0, 1, 1, 2]), 0, len(tones) - 1))
                bb = b + s // 16
                m = tones[idx] if bb == b else nearest_tone(tones_of(chord_at(bb)), tones[idx])
                E("keys", ts(bb, s % 16), (0.36 if b < 107 else 0.26) * hum(0.08), m=m, d=dl * ST * 0.95,
                  pan=float(kr.choice([-0.3, -0.1, 0.1, 0.3])))
    if pad_open is not None:
        pad_open["d"] = ts(BARS, 0) - pad_open["t"]
    return ev


def tones_of(ch):
    return sorted({m + 12 * o for m in voicing(ch) for o in (0, 1, 2) if 67 <= m + 12 * o <= 81})


def nearest_tone(tones, m):
    return min(tones, key=lambda x: (abs(x - m), x))


# ───────────────────────── 악기 (고음·트랜지언트를 누그러뜨린 합성) ─────────────────────────

def _t(n):
    return np.arange(n) / SR


def _fade_tail(y, ms=6):
    k = min(y.shape[-1], int(ms * SR / 1000))
    y[..., -k:] *= np.linspace(1, 0, k)
    return y


def partials(f, dur, v, parts, att=0.004, gate_tau=0.05):
    dur = max(dur, 0.05)
    L = max(min(dur + 0.3, tau * 5 + 0.02) for _, _, tau in parts) + 0.03
    n = int(L * SR)
    t = _t(n)
    y = np.zeros(n)
    for k, vol, tau in parts:
        fk = f * k
        if fk > 8000:
            continue
        e = np.where(t < att, t / att, np.exp(-(t - att) / tau))
        ed = math.exp(-(dur - att) / tau)
        e = np.where(t >= dur, ed * np.exp(-(t - dur) / gate_tau), e)
        y += v * vol * e * np.sin(2 * np.pi * fk * t)
    return _fade_tail(y).astype(F32)


def ins_keys(f, dur, v):
    # 로즈풍: 기음 + 빨리 사라지는 2·3배음, 어택 6ms
    return partials(f, dur, v, [(1, 1, 1.1), (2, 0.2, 0.28), (3, 0.05, 0.09)], att=0.006, gate_tau=0.18)


def ins_stab(notes, dur, fc0):
    """디튠 톱니 화음 → 로우패스(시간에 따라 fc0·(1+0.9e^{-t/70ms})) 를 배음 가산 합성으로. 스테레오."""
    rel = 0.16
    n = int((dur + 0.62) * SR)
    t = _t(n)
    fct = fc0 * (1.0 + 0.9 * np.exp(-t / 0.07))
    inv4 = fct ** -4.0
    env = np.minimum(t / 0.006, 1.0) * (0.35 + 0.65 * np.exp(-t / 0.28))
    env *= np.where(t < dur, 1.0, np.exp(-(t - dur) / rel))
    out = np.zeros((2, n))
    fmax = min(7000.0, fc0 * 1.9 * 3.5)
    for ch, cents in enumerate((-6.0, 6.0)):
        for m in notes:
            f = mtof(m) * 2 ** (cents / 1200)
            ph = rng.random() * 2 * np.pi
            for h in range(1, int(fmax // f) + 1):
                fh = f * h
                g = (1.0 / h) / np.sqrt(1.0 + fh ** 4 * inv4)
                out[ch] += g * np.sin(2 * np.pi * fh * t + ph * h)
    out *= env[None, :] * (0.32 / max(1, len(notes)) ** 0.5)
    return _fade_tail(out).astype(F32)


def ins_pad(notes, dur):
    att, rel = 0.9, 1.4
    n = int((dur + rel * 4) * SR)
    t = _t(n)
    a = np.clip(t / att, 0, 1)
    env = (0.5 - 0.5 * np.cos(np.pi * a))
    env *= np.where(t < dur, 1.0, np.exp(-(t - dur) / rel))
    out = np.zeros((2, n))
    for ch, cents in enumerate(((-5.0, 3.0), (-2.0, 6.0))):
        for m in notes:
            for c in cents:
                f = mtof(m) * 2 ** (c / 1200)
                ph = rng.random() * 2 * np.pi
                out[ch] += np.sin(2 * np.pi * f * t + ph) + 0.16 * np.sin(4 * np.pi * f * t + ph) \
                    + 0.05 * np.sin(6 * np.pi * f * t + ph)
    out *= env[None, :] * (0.25 / len(notes))
    return _fade_tail(out).astype(F32)


def env_target(t, a, peak, tau, sus, end, rel):
    end = max(end, a + 0.01)
    e = np.where(t < a, peak * t / a, peak * sus + peak * (1 - sus) * np.exp(-(t - a) / tau))
    ve = peak * sus + peak * (1 - sus) * math.exp(-(end - a) / tau)
    return np.where(t >= end, ve * np.exp(-(t - end) / rel), e)


def ins_bass(f, dur, v):
    # 따뜻한 서브: 사인 + 약한 2·3배음, 살짝 포화, 어택 8ms, 릴리스 70ms
    n = int((dur + 0.45) * SR)
    t = _t(n)
    y = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(4 * np.pi * f * t) + 0.07 * np.sin(6 * np.pi * f * t)
    y = np.tanh(1.3 * y) / np.tanh(1.3)
    env = env_target(t, 0.008, v, 0.5, 0.7, dur, 0.07)
    return _fade_tail(y * env).astype(F32)


def ins_kick(v):
    # 둥근 킥: 112 → 47 Hz, 어택 4ms(클릭 없음), 감쇠 τ 0.16
    n = int(0.55 * SR)
    t = _t(n)
    f = 47 + (112 - 47) * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.minimum(t / 0.004, 1) * np.exp(-t / 0.16)
    y = np.tanh(1.4 * np.sin(ph) * e) / np.tanh(1.4)
    return _fade_tail(y * v).astype(F32)


def ins_noise(v, dur, att):
    n = int((att + dur * 1.7) * SR) + 32
    t = _t(n)
    e = np.where(t < att, t / att, np.exp(-(t - att) / (dur / 3)))
    return _fade_tail(rng.standard_normal(n) * e * v).astype(F32)


def ins_clap(v):
    # 부드러운 클랩: 10ms 간격 세 번의 짧은 버스트 + 꼬리, 대역은 버스에서
    n = int(0.4 * SR)
    t = _t(n)
    e = np.zeros(n)
    for k, d in enumerate((0.0, 0.010, 0.021)):
        tt = t - d
        e += np.where(tt >= 0, np.minimum(tt / 0.002, 1) * np.exp(-np.maximum(tt, 0) / 0.009), 0) * (0.7 + 0.15 * k)
    tt = t - 0.021
    e += np.where(tt >= 0, 0.55 * np.minimum(tt / 0.003, 1) * np.exp(-np.maximum(tt, 0) / 0.08), 0)
    return _fade_tail(rng.standard_normal(n) * e * v).astype(F32)



# ───────────────────────── 이펙트 (compose_city.py 에서 복사) ─────────────────────────

# ───────────────────────── 이펙트 (compose.py 에서 복사) ─────────────────────────

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

# ───────────────────────── 측정·마스터링 (compose.py 에서 복사) ─────────────────────────

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


def cached(key, fn):
    """같은 키(악기·음·길이·필터)는 단위 세기로 한 번만 합성해 재사용(세기는 선형으로 곱한다)."""
    if key not in _SYN:
        _SYN[key] = fn()
    return _SYN[key]


def render_bus(events, names, fn):
    bus = new_bus()
    for e in events:
        if e["ins"] in names:
            add(bus, e["t"], fn(e), e["pan"])
    return bus


def riser(bus, b0, b1, v):
    """b0～b1 마디 동안 부풀었다가 b1 직전에 사라지는 노이즈 상승(대역은 버스에서)."""
    n = int((b1 - b0) * BAR * SR)
    x = np.linspace(0, 1, n)
    e = x ** 2.2 * np.minimum(1.0, (1 - x) / 0.04)
    add(bus, tb(b0), (rng.standard_normal(n) * e * v).astype(F32), 0.0)


def sec_rms(x):
    """큰 구간별 RMS(dBFS, 마스터 이득 전) — 갈래 버스를 오래 들고 있지 않으려고 바로 잰다."""
    bounds = [s for _, s in SECTIONS] + [BARS]
    row = []
    for k in range(len(SECTIONS)):
        seg = x[:, int(tb(bounds[k]) * SR):int(tb(bounds[k + 1]) * SR)].astype(np.float64)
        row.append(20 * math.log10(max(math.sqrt(float((seg ** 2).mean())), 1e-12)))
    return row


def render(log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()
    events = gen_events()
    st(f"events {len(events)}")
    stems = {}
    mix = new_bus()
    rev_send = new_bus()
    echo_send = new_bus()

    # 킥 + 사이드체인 트리거
    kbus = new_bus()
    trig = np.zeros(N, dtype=F32)
    for e in events:
        if e["ins"] == "kick":
            add(kbus, e["t"], ins_kick(1.0) * F32(e["v"]))
            trig[int(round(e["t"] * SR)) % N] += e["v"]
    duck = sidechain(trig, depth=0.22)
    del trig
    kbus = fd_filter(kbus, hp_mag(f, 30, 2) * lp_mag(f, 1800, 2))
    kbus *= G["kick"]
    stems["kick"] = sec_rms(kbus)
    mix += kbus
    rev_send += 0.03 * kbus
    del kbus
    st("kick")

    # 셰이커·햇·클랩 (모두 7.5kHz 위를 깎아 어둡게)
    sh = render_bus(events, {"shaker"}, lambda e: ins_noise(e["v"], 0.05, 0.008))
    sh = fd_filter(sh, hp_mag(f, 3600, 2) * lp_mag(f, 7200, 3))
    sh *= G["shaker"]
    stems["shaker"] = sec_rms(sh)
    mix += sh
    rev_send += 0.2 * sh
    del sh
    hh = render_bus(events, {"hat"}, lambda e: ins_noise(e["v"], 0.24, 0.004))
    hh = fd_filter(hh, hp_mag(f, 4200, 2) * lp_mag(f, 6500, 3))
    hh *= (0.8 + 0.2 * duck)[None, :]
    hh *= G["hat"]
    stems["open hat"] = sec_rms(hh)
    mix += hh
    rev_send += 0.18 * hh
    del hh
    cl = render_bus(events, {"clap"}, lambda e: ins_clap(e["v"]))
    cl = fd_filter(cl, hp_mag(f, 850, 2) * lp_mag(f, 2600, 2))
    cl *= G["clap"]
    stems["clap"] = sec_rms(cl)
    mix += cl
    rev_send += 0.4 * cl
    del cl
    st("shaker·hat·clap")

    # 코드 스탭 (사건마다 필터 주파수가 다름 → 캐시 키에 포함)
    sb = new_bus()
    for e in events:
        if e["ins"] == "stab":
            sig = cached(("stab", e["notes"], round(e["d"], 4), e["fc"]),
                         lambda e=e: ins_stab(e["notes"], e["d"], e["fc"]))
            add(sb, e["t"], sig * F32(e["v"]))
    st(f"stab synth ({sum(1 for k in _SYN if k[0] == 'stab')} 종)")
    sb = fd_filter(sb, hp_mag(f, 110, 1))
    sb *= (0.45 + 0.55 * duck)[None, :]
    sb *= G["stab"]
    stems["chord stab"] = sec_rms(sb)
    mix += sb
    rsend = automation([(0, 0.22), (108, 0.22), (111, 0.5), (125, 0.5), (127, 0.22), (150, 0.22)])
    rev_send += sb * rsend[None, :]
    echo_send += 0.12 * sb
    del sb, rsend
    st("stab")

    # 패드 (밝기 자동화)
    pb = new_bus()
    for e in events:
        if e["ins"] == "pad":
            sig = cached(("pad", e["notes"], round(e["d"], 3)), lambda e=e: ins_pad(e["notes"], e["d"]))
            add(pb, e["t"], sig * F32(e["v"]))
    bright = automation([(0, 0.0), (32, 0.15), (48, 0.45), (75, 1.0), (107, 0.85), (110, 0.6), (126, 0.45),
                         (142, 0.0), (150, 0.0)])
    hp = hp_mag(f, 130, 1)
    pb = fd_split(pb, hp * lp_mag(f, 700, 2), hp * lp_mag(f, 2600, 2), bright)
    del bright
    pb *= (0.5 + 0.5 * duck)[None, :]
    pb *= G["pad"]
    stems["pad"] = sec_rms(pb)
    mix += pb
    rev_send += 0.5 * pb
    del pb
    st("pad")

    # 건반 선율
    kb = render_bus(events, {"keys"}, lambda e: cached(("keys", e["m"], round(e["d"], 4)),
                                                         lambda: ins_keys(mtof(e["m"]), e["d"], 1.0)) * F32(e["v"]))
    kb = fd_filter(kb, hp_mag(f, 180, 1) * lp_mag(f, 3800, 2))
    kb *= (0.75 + 0.25 * duck)[None, :]
    kb *= G["keys"]
    stems["keys"] = sec_rms(kb)
    mix += kb
    rev_send += 0.4 * kb
    echo_send += 0.45 * kb
    del kb
    st("keys")

    # 서브 베이스
    bs = render_bus(events, {"bass"}, lambda e: cached(("bass", e["m"], round(e["d"], 4)),
                                                        lambda: ins_bass(mtof(e["m"]), e["d"], 1.0)) * F32(e["v"]))
    bs = fd_filter(bs, lp_mag(f, 380, 2) * hp_mag(f, 32, 2))
    bs *= (0.62 + 0.38 * duck)[None, :]
    bs *= G["bass"]
    stems["sub bass"] = sec_rms(bs)
    mix += bs
    del bs
    st("bass")

    # 노이즈 상승(전환·브레이크다운 끝)
    rz = new_bus()
    riser(rz, 71, 75, 1.0)
    riser(rz, 121, 126, 1.0)
    rb = automation([(0, 0), (71, 0), (74.9, 1), (75, 0), (121, 0), (125.9, 1), (126, 0), (150, 0)])
    rz = fd_split(rz, hp_mag(f, 400, 1) * lp_mag(f, 900, 2), hp_mag(f, 600, 1) * lp_mag(f, 4500, 2), rb)
    del rb
    rz *= G["riser"]
    stems["riser"] = sec_rms(rz)
    mix += rz
    rev_send += 0.6 * rz
    del rz
    st("riser")
    del duck

    echo = circ_conv(echo_send.mean(axis=0), echo_ir(delay_beats=0.75, fb=0.3))
    mix += 0.4 * echo
    rev_send += 0.3 * echo
    del echo, echo_send
    st("echo")
    wet = circ_conv(rev_send, reverb_ir(length=2.6, rt60_lo=1.9, rt60_hi=0.8))
    wet = fd_filter(wet, hp_mag(f, 180, 1) * lp_mag(f, 6000, 1))
    mix += 0.26 * wet
    del wet, rev_send
    st("reverb")

    # 마스터: 초저역 정리 + 9kHz 위 완만히 눌러 날카로움 방지
    mix = fd_filter(mix, hp_mag(f, 26, 2) * lp_mag(f, 9500, 1))

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
    stem_rms = {}
    gdb = 20 * math.log10(float(gain))
    for name, row in stems.items():
        stem_rms[name] = [v + gdb for v in row]
    return mix, events, stem_rms, gr


G = {"kick": 0.55, "shaker": 1.45, "hat": 1.2, "clap": 1.4, "stab": 1.0, "pad": 0.9, "keys": 0.38, "bass": 0.42,
     "riser": 0.16}


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




def hf_share(seg, fcut=8000.0):
    """fcut 위 에너지 비율(%)."""
    mono = seg.mean(axis=0).astype(np.float64)
    nfft = 8192
    nfr = len(mono) // nfft
    frames = mono[: nfr * nfft].reshape(nfr, nfft) * np.hanning(nfft)[None, :]
    P = (np.abs(np.fft.rfft(frames, axis=1)) ** 2).sum(axis=0)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    return float(100 * P[fr >= fcut].sum() / P.sum())


def analyze(x, log=print):
    res = {"sections": [], "sub": [], "windows": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    log("\n구간별 에너지")
    log("  구간          시간          RMS(dBFS)  피크(dBFS)  LUFS(근사)  중심(Hz)  8k+(%)")
    for k, (name, b0) in enumerate(SECTIONS):
        t0, t1 = tb(b0), tb(bounds[k + 1])
        seg = x[:, int(t0 * SR):int(t1 * SR)]
        seg64 = seg.astype(np.float64)
        row = dict(name=name, t0=t0, t1=t1, bars=(b0, bounds[k + 1] - 1),
                   rms=db(math.sqrt(float((seg64 ** 2).mean()))), peak=db(float(np.abs(seg).max())),
                   lufs=loudness(seg), cent=centroid(seg), hf=hf_share(seg))
        del seg64
        res["sections"].append(row)
        log(f"  {name:<8}  {mmss(t0)}～{mmss(t1)}    {row['rms']:7.2f}   {row['peak']:8.2f}   {row['lufs']:8.2f}"
            f"   {row['cent']:7.0f}   {row['hf']:.2f}")
    for big, name, b0, b1, _ in SUBS:
        seg = x[:, int(tb(b0) * SR):int(tb(b1) * SR)]
        res["sub"].append(dict(big=big, name=name, b0=b0, b1=b1 - 1, t0=tb(b0), t1=tb(b1),
                               rms=db(math.sqrt(float((seg.astype(np.float64) ** 2).mean()))),
                               lufs=loudness(seg), cent=centroid(seg)))
    res["total_rms"] = db(math.sqrt(float((x.astype(np.float64) ** 2).mean())))
    res["peak"] = db(float(np.abs(x).max()))
    res["lufs"] = loudness(x)
    res["true_peak"] = db(true_peak(x))
    res["cent"] = centroid(x)
    res["hf"] = hf_share(x)
    log(f"  전체      0:00～5:00    {res['total_rms']:7.2f}   {res['peak']:8.2f}   {res['lufs']:8.2f}   {res['cent']:7.0f}"
        f"   {res['hf']:.2f}   (트루피크 근사 {res['true_peak']:.2f} dBTP)")
    log("\n15초 창 RMS 곡선 (dBFS, ■ 1칸 = 1 dB, 기준 -40)")
    for w in range(20):
        seg = x[:, w * 15 * SR:(w + 1) * 15 * SR].astype(np.float64)
        r = db(math.sqrt(float((seg ** 2).mean())))
        tmid = w * 15 + 7.5
        sec = [n for n, b in SECTIONS if tb(b) <= tmid][-1]
        res["windows"].append((w * 15, sec, r))
        log(f"  {mmss(w * 15)} {sec:<6} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    jump = float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max())
    typ = float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max())
    a1 = x[:, -SR:].astype(np.float64)
    b1 = x[:, :SR].astype(np.float64)
    # 이음매 양쪽 4초(2마디) LUFS — 마디 단위로 같은 내용(킥+닫힌 스탭)인지 확인
    l_end = loudness(x[:, -4 * SR:])
    l_start = loudness(x[:, :4 * SR])
    res["seam"] = dict(end50=db(math.sqrt((a ** 2).mean())), start50=db(math.sqrt((b ** 2).mean())),
                       end1s=db(math.sqrt((a1 ** 2).mean())), start1s=db(math.sqrt((b1 ** 2).mean())),
                       jump=jump, typ=typ, cent_end=centroid(x[:, -10 * SR:]), cent_start=centroid(x[:, :10 * SR]),
                       lufs_end=l_end, lufs_start=l_start)
    s = res["seam"]
    log(f"\n루프 이음매: 끝 50ms RMS {s['end50']:.2f} dBFS, 처음 50ms RMS {s['start50']:.2f} dBFS, "
        f"경계 샘플 차 {jump:.5f} (전형적 인접 샘플 차 최대 {typ:.5f}), 끝·처음 4초 LUFS {l_end:.2f} / {l_start:.2f}")
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
    L.append(f"- 생성: `compose_deephouse.py` (seed {SEED}, numpy {np.__version__}), 실행 시간 {elapsed:.0f}초")
    L.append(f"- 형식: {SR} Hz 스테레오, {BITRATE} kbps CBR MP3, {BPM} BPM 4/4, {BARS}마디 = {DUR:.1f}초, {KEY_NAME}")
    L.append(f"- 용도: 활동 단계 {STAGE}(활발), energy {ENERGY}. 소프트 딥하우스 — 둥근 4온더플로어 킥, 어두운 오프비트 오픈햇, "
             f"16분 스윙 셰이커({50 + SWING * 50:.1f}%), 마이너 9·11 코드 스탭(사건마다 로우패스 자동화), 서브 베이스, 약한 사이드체인(22%)")
    L.append("- 자체 작곡(외부 샘플·실존 곡 인용 없음). 파이프라인(원형 버퍼·리버브·리미터·LUFS·MP3)은 `compose_city.py` 에서 복사\n")
    L.append("## 곡 구조\n")
    L.append("| 큰 구간 | 세부 구간 | 시간 | 마디 | 화음 진행 | 편성 |")
    L.append("|---|---|---|---|---|---|")
    for big, name, b0, b1, desc in SUBS:
        seq = []
        for b in range(b0, b1):
            c = chord_at(b).replace("G69", "G6/9")
            if not seq or seq[-1] != c:
                seq.append(c)
            if len(seq) >= 5:
                break
        L.append(f"| {big} | {name} | {mmss(tb(b0))}～{mmss(tb(b1))} | {b0}～{b1 - 1} | {' '.join(seq)} | {desc} |")
    L.append("")
    L.append("스탭 로우패스 기준 주파수(사건마다 1/6옥타브 양자화, 음마다 70ms 엔벨로프로 1.9배에서 내려옴): "
             + ", ".join(f"{b}마디 {STAB_FC(b):.0f}Hz" for b in (0, 16, 32, 48, 72, 75, 103, 110, 126, 138, 146)) + "\n")
    L.append("## 구간별 RMS·LUFS·스펙트럼 중심\n")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) | 8kHz 이상 에너지 (%) |")
    L.append("|---|---|---|---|---|---|---|")
    for r in res["sections"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['peak']:.2f} | {r['lufs']:.2f} | {r['cent']:.0f} | {r['hf']:.2f} |")
    L.append(f"| 전체 | 0:00～5:00 | {res['total_rms']:.2f} | {res['peak']:.2f} | {res['lufs']:.2f} | {res['cent']:.0f} | {res['hf']:.2f} |")
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
        L.append(f"{mmss(t0)} {sec:<6} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    L.append("```")
    L.append("(■ 1칸 = 1 dB, 기준 −40 dBFS)\n")
    s = res["seam"]
    L.append("## 루프 이음매\n")
    L.append("| 항목 | 값 |")
    L.append("|---|---|")
    L.append(f"| 끝 50ms RMS / 처음 50ms RMS | {s['end50']:.2f} / {s['start50']:.2f} dBFS |")
    L.append(f"| 끝 1초 RMS / 처음 1초 RMS | {s['end1s']:.2f} / {s['start1s']:.2f} dBFS |")
    L.append(f"| 끝 4초 LUFS / 처음 4초 LUFS | {s['lufs_end']:.2f} / {s['lufs_start']:.2f} |")
    L.append(f"| 경계 샘플 차(끝→처음) | {s['jump']:.5f} (처음 1초 인접 샘플 차 최대 {s['typ']:.5f}) |")
    L.append(f"| 스펙트럼 중심 끝 10초 / 처음 10초 | {s['cent_end']:.0f} / {s['cent_start']:.0f} Hz |")
    L.append("| 방식 | 300초 원형 버퍼: 끝을 넘는 음 꼬리·리버브·딜레이가 앞머리로 감김. 마지막 마디 Em11 → 첫 마디 Am9, "
             "양끝 모두 킥(같은 세기)+닫힌 스탭(380Hz)·같은 4/4 격자(120 BPM × 150마디 = 정확히 300초) |")
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
    ap = argparse.ArgumentParser(description="'흐르는 라인' 딥하우스 작업 배경음악 합성")
    ap.add_argument("--out", default=DEFAULT_OUT, help="MP3 출력 경로 (json·report·png 는 같은 폴더)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV 도 저장(선택)")
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
        ("8kHz 이상 에너지", "≤ 2%", f"{res['hf']:.2f}%", res["hf"] <= 2.0),
        ("PCM 길이", "정확히 300초", f"{pcm.shape[1]} 샘플 = {pcm.shape[1]/SR:.3f}초", pcm.shape[1] == N),
    ]
    ok = all(c[3] for c in checks)
    elapsed = time.time() - t0
    files = [(os.path.basename(out), len(mp3), mp3_sha), (os.path.basename(jpath), os.path.getsize(jpath), sha(jpath)),
             ("spectrogram.png", os.path.getsize(png), sha(png)),
             ("compose_deephouse.py", os.path.getsize(os.path.abspath(__file__)), sha(os.path.abspath(__file__)))]
    write_report(os.path.join(od, "report.md"), res, stem_rms, {"checks": checks, "files": files, "pcm_sha": pcm_sha},
                 gr, elapsed)
    for c in checks:
        print(f"  {c[0]}: {c[2]} ({c[1]}) {'통과' if c[3] else '실패'}")
    print(f"  검사: {'통과' if ok else '실패'}  (실행 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
