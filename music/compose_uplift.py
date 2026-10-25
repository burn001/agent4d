#!/usr/bin/env python3
"""'상승 기류' 작업 배경음악 결정적 합성기 (활동 단계 3 — 매우 활발).

128 BPM 멜로딕 프로그레시브 일렉트로닉. 외부 샘플·실존 곡 인용 없이 numpy 로 전부 합성한다.
마스터링·원형 루프·검사·MP3 부분은 music/compose_city.py(← compose.py) 를 복사해 재사용했다.

구조: 128 BPM, 4/4, 160마디 = 300초, A major.
  기  0:00～1:00  (마디   0～31)  펄스·플럭 아르페지오 인트로, 닫힌 슈퍼소 패드 → 점8분 플럭 겹침, 첫 라이저
  승  1:00～2:30  (마디  32～79)  소프트 킥·16분 롤링 베이스·오프비트 하이햇·클랩, 세 번째 아르페지오,
                                  메인 테마 예고(플럭), 필터 열림·라이저·클랩 롤
  전  2:30～3:37  (마디  80～115) 메인 테마 클라이맥스(소프트 소 리드+플럭), 4마디 브레이크, 부드러운 드롭(옥타브 겹침)
  결  3:37～5:00  (마디 116～159) 레이어 걷어내기(클랩·셰이커 → 베이스·하이햇 → 킥), 펄스·플럭으로 처음과 이어짐

루프: 모든 꼬리·리버브·딜레이는 300초 원형 버퍼로 앞머리에 감긴다. 끝 12마디와 처음 16마디는 같은 편성·밝기·레벨.

사용법:
  python compose_uplift.py --out bgm-uplift.mp3 [--wav 미리듣기.wav]
  (같은 폴더에 bgm-uplift.json, report.md, spectrogram.png 도 만든다)
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

SEED = 3128
SR = 44100
BPM = 128
BEAT = 60.0 / BPM            # 0.46875 s
ST = BEAT / 4                # 16분음표
BAR = 4 * BEAT               # 1.875 s
BARS = 160
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -2.0               # 샘플 피크 상한(트루 피크·MP3 오버슈트가 −1.5 dBFS 를 넘지 않게)
BITRATE = 128
SECTIONS = [("기", 0), ("승", 32), ("전", 80), ("결", 116)]
TITLE = "상승 기류"
KEY_NAME = "A major"
STAGE = 3
ENERGY = 0.85
MOOD = ("매우 활발한 대량 작업용 추진력 — 128 BPM 멜로딕 프로그레시브, 16분 롤링 펄스 베이스, 겹겹이 쌓는 플럭 아르페지오, "
        "넓은 슈퍼소 패드, 부드러운 킥·클랩, 점점 열리는 필터, 귀가 피로하지 않게 고음을 누른 장조 업리프팅")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "bgm-uplift.mp3")

rng = np.random.default_rng(SEED)
F32 = np.float32


# ───────────────────────── 기본 유틸 (compose.py·compose_city.py 에서 복사) ─────────────────────────

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
        _FREQ = np.fft.rfftfreq(N, 1.0 / SR).astype(F32)
    return _FREQ


def lp_mag(f, fc, order=2):
    return (1.0 / np.sqrt(1.0 + (f / F32(fc)) ** (2 * order))).astype(F32)


def hp_mag(f, fc, order=2):
    r = (f / F32(fc)) ** (2 * order)
    return np.sqrt(r / (1.0 + r)).astype(F32)


def fd_filter(x, mag):
    """원형(루프) 영위상 주파수 영역 필터(채널별로 처리해 메모리를 아낀다)."""
    mag = mag.astype(F32)
    for ch in range(x.shape[0]):
        X = np.fft.rfft(x[ch])
        X *= mag
        x[ch] = np.fft.irfft(X, n=N)
    return x


def fd_split(x, mag_dark, mag_bright, bright):
    """rfft 한 번으로 어두운·밝은 두 필터 결과를 bright 곡선으로 섞는다(채널별)."""
    md, mb = mag_dark.astype(F32), mag_bright.astype(F32)
    for ch in range(x.shape[0]):
        X = np.fft.rfft(x[ch])
        d = np.fft.irfft(X * md, n=N)
        b = np.fft.irfft(X * mb, n=N)
        del X
        x[ch] = d * (1 - bright) + b * bright
        del d, b
    return x


def circ_conv(x, ir):
    """원형 FFT 컨볼루션. x:(2,N) 또는 (N,), ir:(2,M)."""
    out = np.zeros((2, N), dtype=F32)
    for ch in range(2):
        src = x[ch] if x.ndim == 2 else x
        h = np.zeros(N, dtype=F32)
        h[: ir.shape[1]] = ir[ch]
        out[ch] = np.fft.irfft(np.fft.rfft(src) * np.fft.rfft(h), n=N)
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


# ───────────────────────── 화음 (compose_city.py 에서 복사) ─────────────────────────

def mod12(n):
    return n % 12


NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
        "m9": [0, 3, 7, 10, 14], "maj9": [0, 4, 7, 11, 14], "9": [0, 4, 7, 10, 14], "6": [0, 4, 7, 9],
        "sus2": [0, 2, 7], "sus4": [0, 5, 7], "add9": [0, 4, 7, 14]}


def pc_of(s):
    acc = 1 if len(s) > 1 and s[1] == "#" else -1 if len(s) > 1 and s[1] == "b" else 0
    return mod12(NOTE_PC[s[0]] + acc)


_CC = {}


def chord_p(name):
    if name in _CC:
        return _CC[name]
    main, _, slash = name.partition("/")
    acc = 2 if len(main) > 1 and main[1] in "#b" else 1
    iv = QUAL[main[acc:]]
    r = pc_of(main)
    ch = {"name": name, "r": r, "iv": iv, "pcs": [mod12(r + x) for x in iv],
          "bass": pc_of(slash) if slash else r}
    _CC[name] = ch
    return ch


def nearest_pc(m, pcs):
    for d in range(7):
        if mod12(m - d) in pcs:
            return m - d
        if mod12(m + d) in pcs:
            return m + d
    return m


def bass_note(pc, lo):
    return lo + mod12(pc - lo)


def voicing(ch, center, n, rootless=False):
    iv = ch["iv"]
    pri = [iv[i] for i in (1, 3, 4, 2, 5) if i < len(iv)]
    if not rootless:
        pri.insert(0, 0)
    pcs = []
    for x in pri:
        pc = mod12(ch["r"] + x)
        if pc not in pcs:
            pcs.append(pc)
        if len(pcs) >= n:
            break
    out = sorted(nearest_pc(center, [pc]) for pc in pcs)
    for i in range(1, len(out)):
        if out[i] <= out[i - 1]:
            out[i] += 12
    return out


# ───────────────────────── 곡 데이터 ─────────────────────────

# 마디마다 화음 하나(대개 2마디씩 유지). A major: I–vi–IV–V / IV–V–vi–iii / 테마 IV–V–vi–iii–IV–V–vi–Vsus
PROGS = {
    "PA": "Aadd9 Aadd9 F#m7 F#m7 Dmaj9 Dmaj9 Esus4 E",
    "PB": "Dmaj9 Dmaj9 E E F#m7 F#m7 C#m7 C#m7",
    "PC": "D D E E F#m7 F#m7 C#m7 C#m7 Dmaj7 Dmaj7 E E F#m F#m Esus4 E",
    "BRK": "Dmaj9 Dmaj9 Esus4 E",
    "OUT": "F#m7 F#m7 Dmaj9 Dmaj9 Esus4 E Aadd9 Aadd9 Dmaj9 Dmaj9 Esus4 E",
}
PROGS = {k: v.split() for k, v in PROGS.items()}

# 메인 테마: 2마디(16분 32걸음) 프레이즈 8개, (시작, 길이, MIDI). 3+3+2 당김 동기, 최고음 E6.
PHR = [
    [(0, 3, 81), (3, 3, 78), (6, 2, 81), (8, 4, 83), (12, 4, 81), (16, 6, 78), (22, 2, 76), (24, 8, 78)],   # D
    [(0, 3, 80), (3, 3, 76), (6, 2, 80), (8, 4, 83), (12, 4, 85), (16, 6, 83), (22, 2, 80), (24, 8, 83)],   # E
    [(0, 3, 85), (3, 3, 81), (6, 2, 85), (8, 4, 88), (12, 4, 85), (16, 6, 83), (22, 2, 81), (24, 8, 85)],   # F#m7
    [(0, 3, 83), (3, 3, 80), (6, 2, 76), (8, 4, 80), (12, 4, 83), (16, 12, 85), (28, 4, 83)],               # C#m7
    [(0, 3, 81), (3, 3, 78), (6, 2, 81), (8, 4, 85), (12, 4, 81), (16, 6, 81), (22, 2, 83), (24, 8, 85)],   # Dmaj7
    [(0, 3, 83), (3, 3, 80), (6, 2, 83), (8, 4, 88), (12, 4, 85), (16, 6, 83), (22, 2, 85), (24, 8, 88)],   # E
    [(0, 3, 85), (3, 3, 81), (6, 2, 85), (8, 4, 88), (12, 4, 85), (16, 6, 81), (22, 2, 83), (24, 8, 85)],   # F#m
    [(0, 4, 83), (4, 4, 81), (8, 4, 83), (12, 4, 81), (16, 12, 80), (28, 4, 76)],                          # Esus4 | E
]

# on: 켜는 갈래, th: 테마 레이어 [(악기, 옥타브, 세기, 조건)], riser: (시작 마디, 길이 마디, 세기)
SECS = [
    dict(n="인트로", bars=16, p="PA", on="pulse arpA pad"),
    dict(n="인트로 2", bars=16, p="PA", on="pulse arpA arpB pad shk8", riser=(12, 4, 0.55)),
    dict(n="그루브", bars=16, p="PA", on="pulse arpA arpB pad kick bass hat clap"),
    dict(n="빌드업", bars=16, p="PB", on="pulse arpA arpB arpC pad kick bass hat clap shaker"),
    dict(n="빌드업 2", bars=16, p="PC", on="pulse arpA arpB arpC pad kick bass hat clap shaker roll",
         th=[("tpluck", -12, 0.085, "lo8"), ("tpluck", 0, 0.07, "hi8")], riser=(12, 4, 1.0)),
    dict(n="클라이맥스", bars=16, p="PC", on="pulse arpA arpB arpC pad kick bass hat clap shaker impact",
         th=[("lead", 0, 0.075, ""), ("tpluck", -12, 0.05, "")]),
    dict(n="브레이크", bars=4, p="BRK", on="pulse arpA arpB pad", th=[("tpluck", 0, 0.075, "")], riser=(2, 2, 0.8)),
    dict(n="드롭", bars=16, p="PC", on="pulse arpA arpB arpC pad kick bass hat clap shaker impact",
         th=[("lead", 0, 0.075, ""), ("lead", -12, 0.04, ""), ("tpluck", 0, 0.04, "")]),
    dict(n="정리", bars=16, p="PA", on="pulse arpA arpB pad kick bass hat clap shaker"),
    dict(n="정리 2", bars=16, p="PA", on="pulse arpA pad kick bass hat"),
    dict(n="아웃트로", bars=12, p="OUT", on="pulse arpA pad"),
]
MAP = []
for _i, _s in enumerate(SECS):
    _s["i"] = _i
    _s["on"] = set(_s["on"].split())
    for _b in range(_s["bars"]):
        MAP.append((_i, _b))
assert len(MAP) == BARS, len(MAP)
SEC_START = {}
_acc = 0
for _s in SECS:
    SEC_START[_s["n"]] = _acc
    _acc += _s["bars"]
CHN = [PROGS[SECS[si]["p"]][bl % len(PROGS[SECS[si]["p"]])] for si, bl in MAP]


# ───────────────────────── 생성기 ─────────────────────────

def gen_bar(bi):
    si, bl = MAP[bi]
    sec = SECS[si]
    on = sec["on"]
    nm = sec["n"]
    ch = chord_p(CHN[bi])
    r = np.random.default_rng(SEED * 1000 + bi)     # 마디별 씨앗(결정적)
    ev = []

    def E(s, ins, m, l, v, pan=0.0, jit=0.0015):
        ev.append({"s": s, "ins": ins, "m": m, "l": l, "v": v, "pan": pan, "jit": jit})

    # 펄스: 중음역 16분 근음 펄스(마지막 16분 옥타브 위)
    if "pulse" in on:
        root = bass_note(ch["bass"], 47)
        for s in range(16):
            E(s, "pulse", root + (12 if s == 14 else 0), 1, 0.1 * [1.0, 0.5, 0.72, 0.55][s % 4], 0.0, 0.0)
    # 롤링 베이스: 킥 자리를 비운 16분 3연속
    bass_on = "bass" in on and not (nm == "정리 2" and bl >= 8)
    if bass_on:
        root = bass_note(ch["bass"], 36)
        for s in range(16):
            if s % 4:
                E(s, "bass", root + (12 if (s == 15 and bl % 4 == 3) else 0), 1, 0.2 * [0, 0.78, 1.0, 0.86][s % 4], 0.0, 0.0)
    # 킥(4 온 더 플로어). 빌드업 2 끝 마디 후반은 비운다, 정리 2 끝 4마디는 줄어든다
    if "kick" in on:
        kv = 1.0 - (0.15 * (bl - 11) if nm == "정리 2" and bl >= 12 else 0.0)
        for s in (0, 4, 8, 12):
            if nm == "빌드업 2" and bl == 15 and s >= 8:
                continue
            E(s, "kick", 0, 1, 0.3 * kv, 0.0, 0.0)
    clap_on = "clap" in on and not (nm == "그루브" and bl < 8) and not (nm == "정리" and bl >= 8)
    if clap_on and not ("roll" in on and bl >= 14):
        for s in (4, 12):
            E(s, "clap", 0, 1, 0.06, -0.05, 0.0)
    if "roll" in on and bl >= 14:        # 클랩 롤: 8분 → 16분, 점점 세게(작게 유지)
        step = 2 if bl == 14 else 1
        for s in range(0, 16, step):
            g = (bl - 14) * 16 + s
            E(s, "clap", 0, 1, 0.018 + 0.032 * g / 32, 0.1 * ((s // step) % 2 * 2 - 1), 0.0)
    hat_on = "hat" in on and not (nm == "정리 2" and bl >= 8)
    if hat_on:
        for s in (2, 6, 10, 14):
            E(s, "hat", 0, 1, 0.05 if s != 14 else 0.042, 0.2, 0.002)
    shaker_on = "shaker" in on and not (nm == "정리" and bl >= 8)
    if shaker_on:
        for s in range(16):
            E(s, "shaker", 0, 1, [0.02, 0.011, 0.016, 0.011][s % 4], -0.35, 0.002)
    if "shk8" in on and bl >= 8:
        for s in range(0, 16, 2):
            E(s, "shaker", 0, 1, (0.014 if s % 4 == 0 else 0.01) * (0.6 + 0.05 * (bl - 8)), -0.35, 0.002)
    # 아르페지오 A(16분, 중음역) — 처음 8마디·마지막 8마디는 8분만
    if "arpA" in on:
        tones = voicing(ch, 62, 4)
        seq = (tones + [x + 12 for x in tones])[:5]      # 3화음이면 위 옥타브로 채운다
        pat = [0, 1, 2, 3, 4, 3, 2, 1] if bl % 2 == 0 else [0, 2, 1, 3, 2, 4, 3, 1]
        eighths = bi < 8 or bi >= 152
        for s in range(16):
            if eighths and s % 2:
                continue
            E(s, "arpA", seq[pat[s % 8]], 1, 0.09 * [1.0, 0.6, 0.8, 0.62][s % 4], -0.2 + 0.4 * (s % 2))
    # 아르페지오 B(점8분, 고음역) — 4박에 대한 3 걸음 엇박
    if "arpB" in on:
        tones = voicing(ch, 74, 3)
        for s in range(16):
            g = bi * 16 + s
            if g % 3 == 0:
                E(s, "arpB", tones[(g // 3) % 3], 2, 0.07, 0.45 if (g // 3) % 2 else -0.45)
    # 아르페지오 C(오프비트 8분 벨)
    if "arpC" in on:
        tones = voicing(ch, 81, 3)
        for k, s in enumerate((2, 6, 10, 14)):
            E(s, "bell", tones[(k + bl) % 3], 2, 0.045, 0.3 * (1 if k % 2 else -1))
    # 메인 테마
    for ins, octv, vel, cond in sec.get("th", []):
        if (cond == "lo8" and bl >= 8) or (cond == "hi8" and bl < 8):
            continue
        ph = PHR[(bl // 2) % 8]
        off = (bl % 2) * 16
        for s, l, m in ph:
            if off <= s < off + 16:
                E(s - off, ins, m + octv, l, vel, 0.08 if ins == "lead" else -0.12)
    if "riser" in sec and bl == sec["riser"][0]:
        _, nb, rv = sec["riser"]
        E(0, "riser", 0, nb * 16, rv, 0.0, 0.0)
    if "impact" in on and bl == 0:
        E(0, "impact", 0, 1, 1.0, 0.0, 0.0)
    for e in ev:
        e["t"] = tb(bi) + e["s"] * ST + (float(r.random()) - 0.5) * 2 * e["jit"]
        e["d"] = e["l"] * ST
        e["bar"] = bi
    return ev


def build_events():
    ev = []
    for bi in range(BARS):
        ev.extend(gen_bar(bi))
    # 슈퍼소 패드: 같은 화음이 이어지는 마디를 하나로 묶어 레가토로
    runs = []
    b = 0
    while b < BARS:
        e = b
        while e + 1 < BARS and CHN[e + 1] == CHN[b]:
            e += 1
        runs.append((b, e - b + 1))
        b = e + 1
    for b, n in runs:
        ch = chord_p(CHN[b])
        vs = voicing(ch, 64, 4) + [bass_note(ch["r"], 48)]
        for j, m in enumerate(vs):
            ev.append({"s": 0, "ins": "pad", "m": m, "l": n * 16, "v": 0.03, "pan": 0.0, "t": tb(b),
                       "d": n * BAR + 0.04, "bar": b})
    return ev


# ───────────────────────── 악기 (전부 합성, 고음·트랜지언트 누그러뜨림) ─────────────────────────

def _t(n):
    return np.arange(n) / SR


def _fade_tail(y, ms=6):
    k = min(y.shape[-1], int(ms * SR / 1000))
    y[..., -k:] *= np.linspace(1, 0, k)
    return y


def env_target(t, a, peak, tau, sus, end, rel):
    """선형 어택 → 지수 감쇠(지속 sus) → end 에서 rel 로 0."""
    end = max(end, a + 0.01)
    e = np.where(t < a, peak * t / a, peak * sus + peak * (1 - sus) * np.exp(-(t - a) / tau))
    ve = peak * sus + peak * (1 - sus) * math.exp(-(end - a) / tau)
    return np.where(t >= end, ve * np.exp(-(t - end) / rel), e)


def add_pluck(f, dur, v, *, odd=False, mult=7.0, fmin=1.4, cap=4500.0, tau_f=0.07, att=0.004,
              env_tau=0.22, sus=0.12, rel=0.09, hmax=7000.0):
    """톱니(또는 사각) 가산 합성 + 빨리 닫히는 저역 통과 → 플럭. 배음 상한 hmax."""
    n = int((dur + rel * 5 + 0.01) * SR)
    t = _t(n)
    fc = f * fmin + (min(cap, f * mult) - f * fmin) * np.exp(-t / tau_f)
    y = np.zeros(n)
    hs = range(1, 200, 2) if odd else range(1, 200)
    for h in hs:
        fh = f * h
        if fh > hmax:
            break
        y += np.sin(2 * np.pi * fh * t) / h / np.sqrt(1 + (fh / fc) ** 4)
    env = env_target(t, att, v, env_tau, sus, dur, rel)
    return _fade_tail(y * env * 0.7).astype(F32)


def ins_pulse(f, dur, v):
    return add_pluck(f, dur, v, mult=6, fmin=1.5, cap=2000, tau_f=0.05, att=0.003, env_tau=0.09, sus=0.0, rel=0.03,
                     hmax=4000)


def ins_bass(f, dur, v):
    n = int((dur + 0.25) * SR)
    t = _t(n)
    y = add_pluck(f, dur, 1.0, mult=10, fmin=2.0, cap=1500, tau_f=0.045, att=0.004, env_tau=0.12, sus=0.35, rel=0.035,
                  hmax=3000)
    m = min(n, len(y))
    env = env_target(t[:m], 0.004, 1.0, 0.14, 0.45, dur, 0.035)
    out = 0.8 * y[:m] + 0.55 * np.sin(2 * np.pi * f * t[:m]) * env
    out = np.tanh(1.3 * out) / np.tanh(1.3)
    return _fade_tail(out * v).astype(F32)


def ins_arpA(f, dur, v):
    return add_pluck(f, dur, v, odd=True, mult=7, fmin=1.4, cap=4500, tau_f=0.07, env_tau=0.2, sus=0.1, rel=0.09)


def ins_arpB(f, dur, v):
    return add_pluck(f, dur, v, mult=6, fmin=1.3, cap=4000, tau_f=0.09, env_tau=0.28, sus=0.08, rel=0.12)


def ins_tpluck(f, dur, v):
    return add_pluck(f, dur, v, mult=6, fmin=1.6, cap=4500, tau_f=0.12, env_tau=0.35, sus=0.25, rel=0.15)


def ins_bell(f, dur, v):
    n = int((dur + 1.4) * SR)
    t = _t(n)
    y = np.zeros(n)
    for k, vol, tau in ((1, 1.0, 0.45), (2, 0.22, 0.15), (3, 0.05, 0.06)):
        e = np.minimum(t / 0.005, 1) * np.exp(-t / tau)
        y += vol * e * np.sin(2 * np.pi * f * k * t)
    return _fade_tail(y * v).astype(F32)


def ins_lead(f, dur, v):
    """소프트 소 리드: 디튠 톱니 3개 + 옥타브 아래 사인, 완만한 어택."""
    rel = 0.22
    n = int((dur + rel * 5) * SR)
    t = _t(n)
    y = np.zeros(n)
    for c in (-9.0, 0.0, 9.0):
        y += polyblep_saw(f * 2 ** (c / 1200), n, float(rng.random()))
    y = y / 3 + 0.35 * np.sin(np.pi * f * t)
    env = env_target(t, 0.014, v, 0.5, 0.65, dur, rel)
    return _fade_tail(y * env).astype(F32)


def ins_pad(f, dur, v):
    """슈퍼소 패드: 디튠 톱니 7개를 좌우로 벌려 스테레오."""
    rel = 1.4
    n = int((dur + rel * 4) * SR)
    t = _t(n)
    env = env_target(t, min(0.6, dur * 0.3), v, 2.5, 0.9, dur, rel)
    out = np.zeros((2, n))
    for k, c in enumerate((-19.0, -12.0, -6.0, 0.0, 6.0, 12.0, 19.0)):
        s = polyblep_saw(f * 2 ** (c / 1200), n, float(rng.random()))
        if c == 0.0:
            out += 0.7 * s
        else:
            out[k % 2] += s
    return _fade_tail(out * env * 0.3).astype(F32)


def ins_kick(v):
    """소프트 킥: 110 → 45 Hz, 2.5ms 어택, 클릭 없음."""
    n = int(0.6 * SR)
    t = _t(n)
    f = 45 * (110 / 45) ** np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.minimum(t / 0.0025, 1) * np.exp(-t / 0.15)
    return _fade_tail(np.sin(ph) * e * v).astype(F32)


def ins_clap(v):
    n = int(0.4 * SR)
    t = _t(n)
    nz = rng.standard_normal(n)
    e = np.zeros(n)
    for td, g in ((0.0, 0.6), (0.009, 0.75), (0.019, 0.9)):
        m = t >= td
        e[m] += g * np.minimum((t[m] - td) / 0.0015, 1) * np.exp(-(t[m] - td) / 0.005)
    m = t >= 0.019
    e[m] += 0.55 * np.minimum((t[m] - 0.019) / 0.003, 1) * np.exp(-(t[m] - 0.019) / 0.075)
    return _fade_tail(nz * e * v).astype(F32)


def ins_noise(v, dur, att):
    n = int((att + dur * 1.7) * SR) + 32
    t = _t(n)
    e = np.where(t < att, t / att, np.exp(-(t - att) / (dur / 3)))
    return _fade_tail(rng.standard_normal(n) * e * v).astype(F32)


def ins_riser(dur, v):
    """노이즈 라이저: 어두운 대역 → 밝은 대역으로 크로스페이드, 세기 상승, 끝에서 40ms 로 닫힘."""
    n = int(dur * SR)
    t = _t(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    out = np.zeros((2, n))
    x = t / dur
    for ch in range(2):
        X = np.fft.rfft(rng.standard_normal(n))
        lo = np.fft.irfft(X * lp_mag(fr, 600, 1) * hp_mag(fr, 150, 1), n=n)
        hi = np.fft.irfft(X * hp_mag(fr, 1200, 1) * lp_mag(fr, 5000, 2), n=n)
        out[ch] = lo * (1 - x ** 1.5) + 0.8 * hi * x ** 1.5
    env = (x ** 2) * v
    k = int(0.04 * SR)
    env[-k:] *= np.linspace(1, 0, k)
    return (out * env[None, :]).astype(F32)


def ins_impact(v):
    """부드러운 드롭 지점 저역 붐 + 짧은 저역 바람."""
    n = int(2.2 * SR)
    t = _t(n)
    f = 38 * (72 / 38) ** np.exp(-t / 0.25)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.minimum(t / 0.01, 1) * np.exp(-t / 0.6)
    nz = rng.standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    nz = np.fft.irfft(np.fft.rfft(nz) * lp_mag(fr, 900, 1), n=n)
    y += 0.25 * nz * np.minimum(t / 0.02, 1) * np.exp(-t / 0.5)
    return _fade_tail(y * v).astype(F32)


# ───────────────────────── 이펙트 (compose.py 에서 복사) ─────────────────────────

def reverb_ir(length=3.0, rt60_lo=2.3, rt60_hi=0.9):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    pre = int(0.016 * SR)
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


def echo_ir(delay_beats=0.75, fb=0.34, taps=7):
    d = delay_beats * BEAT
    n = int(d * (taps + 1) * SR) + 16
    ir = np.zeros((2, n))
    for k in range(1, taps + 1):
        i = int(round(k * d * SR))
        ir[(k + 1) % 2, i] = fb ** (k - 1) * 0.6
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * lp_mag(fr, 2800, 1) * hp_mag(fr, 250, 1), n=n, axis=1)
    return ir.astype(F32)


def sidechain(T, depth, ref=0.3, tau=0.15):
    """T = rfft(킥 트리거). 한 번 구한 스펙트럼을 여러 깊이·시간상수에 재사용한다."""
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    shape = (1 - np.exp(-t / 0.006)) * np.exp(-t / tau)
    h = np.zeros(N, dtype=F32)
    h[:n] = shape
    env = np.fft.irfft(T * np.fft.rfft(h), n=N)
    return (1 - depth * np.clip(env / ref, 0, 1)).astype(F32)


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
    """통합 라우드니스(LUFS 근사, BS.1770 게이트). x:(2,n)."""
    n = x.shape[1]
    fr = np.fft.rfftfreq(n, 1 / SR)
    kwm = k_weight_mag(fr).astype(F32)
    sq = np.zeros(n)
    for ch in range(2):
        kw = np.fft.irfft(np.fft.rfft(x[ch].astype(F32)) * kwm, n=n).astype(np.float64)
        sq += kw ** 2
        del kw
    cs = np.concatenate([[0.0], np.cumsum(sq)])
    del sq
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
    g = np.minimum(g, 1.0).astype(F32)
    x *= g[None, :]
    return x, float(20 * np.log10(g.min()))


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
    _SYN.clear()
    return bus


def sec_rms(x):
    bounds = [s for _, s in SECTIONS] + [BARS]
    row = []
    for k in range(len(SECTIONS)):
        seg = x[:, int(tb(bounds[k]) * SR):int(tb(bounds[k + 1]) * SR)].astype(np.float64)
        row.append(math.sqrt(float((seg ** 2).mean())))
    return row


# 밝기(필터 열림) 자동화 — 처음과 끝 값이 같아 루프가 이어진다
BRIGHT = [(0, 0.12), (16, 0.22), (32, 0.38), (48, 0.52), (64, 0.64), (76, 0.75), (80, 1.0), (96, 0.6), (98, 0.75),
          (100, 1.0), (116, 0.82), (132, 0.5), (148, 0.18), (152, 0.12), (160, 0.12)]


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

    # 킥 + 사이드체인 트리거 + 임팩트
    kbus = new_bus()
    trig = np.zeros(N, dtype=F32)
    for e in events:
        if e["ins"] == "kick":
            add(kbus, e["t"], ins_kick(e["v"]))
            trig[int(round(e["t"] * SR)) % N] += e["v"]
        elif e["ins"] == "impact":
            add(kbus, e["t"], ins_impact(0.22))
    T = np.fft.rfft(trig)
    duck_pad = sidechain(T, 0.32)
    duck_bass = sidechain(T, 0.55, tau=0.11)
    duck_mid = sidechain(T, 0.16)
    del trig, T
    kbus = fd_filter(kbus, hp_mag(f, 30, 2) * lp_mag(f, 2200, 2))
    kbus *= 0.5
    stems["킥·임팩트"] = sec_rms(kbus)
    mix += kbus
    rev_send += 0.03 * kbus
    del kbus
    st("kick")

    cl = render_bus(events, {"clap"}, lambda e: ins_clap(e["v"]))
    cl = fd_filter(cl, hp_mag(f, 900, 2) * lp_mag(f, 3800, 2))
    cl *= 4.5
    stems["클랩"] = sec_rms(cl)
    mix += cl
    rev_send += 0.5 * cl
    del cl
    hh = render_bus(events, {"hat"}, lambda e: ins_noise(e["v"], 0.06, 0.002))
    sh = render_bus(events, {"shaker"}, lambda e: ins_noise(e["v"], 0.045, 0.008))
    hh += sh
    del sh
    hh = fd_filter(hh, hp_mag(f, 3600, 2) * lp_mag(f, 6000, 4))
    hh *= 2.3
    stems["하이햇·셰이커"] = sec_rms(hh)
    mix += hh
    rev_send += 0.2 * hh
    del hh
    rs = render_bus(events, {"riser"}, lambda e: ins_riser(e["d"], e["v"]))
    rs *= 0.05
    stems["라이저"] = sec_rms(rs)
    mix += rs
    rev_send += 0.5 * rs
    del rs
    st("clap·hat·riser")

    bright = automation(BRIGHT)

    bs = render_bus(events, {"bass"}, lambda e: cached("bass", e["m"], e["d"], ins_bass) * F32(e["v"]))
    bs = fd_split(bs, hp_mag(f, 32, 2) * lp_mag(f, 380, 2), hp_mag(f, 32, 2) * lp_mag(f, 1100, 2), bright)
    bs *= duck_bass[None, :]
    bs *= 0.4
    stems["베이스"] = sec_rms(bs)
    mix += bs
    rev_send += 0.02 * bs
    del bs, duck_bass
    st("bass")

    pu = render_bus(events, {"pulse"}, lambda e: cached("pulse", e["m"], e["d"], ins_pulse) * F32(e["v"]))
    pu = fd_split(pu, hp_mag(f, 110, 2) * lp_mag(f, 650, 2), hp_mag(f, 140, 2) * lp_mag(f, 1800, 2), bright)
    pu *= (automation([(0, 1.0), (30, 1.0), (32, 0.6), (146, 0.6), (150, 1.0), (160, 1.0)]) * duck_mid)[None, :]
    pu *= 1.2
    stems["펄스"] = sec_rms(pu)
    mix += pu
    rev_send += 0.12 * pu
    del pu
    st("pulse")

    hpm = hp_mag(f, 160, 1)
    ar = render_bus(events, {"arpA"}, lambda e: cached("arpA", e["m"], e["d"], ins_arpA) * F32(e["v"]))
    ar = fd_split(ar, hpm * lp_mag(f, 1300, 2), hpm * lp_mag(f, 4800, 2), bright)
    ar *= (automation([(0, 1.0), (32, 1.05), (80, 0.85), (116, 0.95), (148, 1.0), (160, 1.0)]) * duck_mid)[None, :]
    ar *= 1.15
    stems["아르페지오 A"] = sec_rms(ar)
    mix += ar
    rev_send += 0.3 * ar
    echo_send += 0.18 * ar
    del ar
    ar = render_bus(events, {"arpB"}, lambda e: cached("arpB", e["m"], e["d"], ins_arpB) * F32(e["v"]))
    ar = fd_split(ar, hpm * lp_mag(f, 1600, 2), hpm * lp_mag(f, 5000, 2), bright)
    ar *= duck_mid[None, :]
    ar *= 1.0
    stems["아르페지오 B"] = sec_rms(ar)
    mix += ar
    rev_send += 0.4 * ar
    echo_send += 0.32 * ar
    del ar
    ar = render_bus(events, {"bell"}, lambda e: cached("bell", e["m"], e["d"], ins_bell) * F32(e["v"]))
    ar = fd_filter(ar, hp_mag(f, 300, 1) * lp_mag(f, 5000, 2))
    ar *= 1.0
    stems["벨 C"] = sec_rms(ar)
    mix += ar
    rev_send += 0.5 * ar
    echo_send += 0.3 * ar
    del ar
    st("arps")

    th = render_bus(events, {"tpluck"}, lambda e: cached("tpluck", e["m"], e["d"], ins_tpluck) * F32(e["v"]))
    th = fd_split(th, hpm * lp_mag(f, 1800, 2), hpm * lp_mag(f, 4800, 2), bright)
    th *= 1.3
    stems["테마 플럭"] = sec_rms(th)
    mix += th
    rev_send += 0.4 * th
    echo_send += 0.35 * th
    del th
    ld = render_bus(events, {"lead"}, lambda e: cached("lead", e["m"], e["d"], ins_lead) * F32(e["v"]))
    ld = fd_filter(ld, hp_mag(f, 200, 1) * lp_mag(f, 3200, 2))
    ld *= (0.85 + 0.15 * duck_mid)[None, :]
    ld *= 1.25
    stems["리드"] = sec_rms(ld)
    mix += ld
    rev_send += 0.45 * ld
    echo_send += 0.3 * ld
    del ld
    st("theme")

    pd = new_bus()
    for e in events:
        if e["ins"] == "pad":
            add(pd, e["t"], cached("pad", e["m"], e["d"], ins_pad) * F32(e["v"]))
    _SYN.clear()
    pd = fd_split(pd, hp_mag(f, 120, 1) * lp_mag(f, 800, 2), hp_mag(f, 120, 1) * lp_mag(f, 3400, 2), bright)
    pd *= (automation([(0, 0.45), (16, 0.55), (32, 0.65), (48, 0.8), (64, 0.9), (80, 1.0), (116, 0.85), (132, 0.65),
                       (148, 0.5), (156, 0.45), (160, 0.45)]) * duck_pad)[None, :]
    pd *= 1.35
    stems["슈퍼소 패드"] = sec_rms(pd)
    mix += pd
    rev_send += 0.5 * pd
    del pd, duck_pad, duck_mid
    st("pad")
    del bright

    echo = circ_conv(echo_send.mean(axis=0), echo_ir())
    del echo_send
    mix += 0.45 * echo
    rev_send += 0.35 * echo
    del echo
    st("echo")
    wet = circ_conv(rev_send, reverb_ir())
    del rev_send
    wet = fd_filter(wet, hp_mag(f, 180, 1) * lp_mag(f, 6500, 1))
    mix += 0.28 * wet
    del wet
    st("reverb")

    # 초저역 정리 + 9kHz 위를 완만히 눌러 날카로움 방지
    mix = fd_filter(mix, hp_mag(f, 28, 2) * lp_mag(f, 9500, 1))

    lufs0 = loudness(mix)
    gain = F32(10 ** ((TARGET_LUFS - lufs0) / 20))
    mix *= gain
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
    for _ in range(3):
        l1 = loudness(mix)
        if abs(l1 - TARGET_LUFS) < 0.1:
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
    stem_rms = {k: [20 * math.log10(max(v * float(gain), 1e-9)) for v in row] for k, row in stems.items()}
    return mix, events, stem_rms, gr


def to_int16(x):
    d = (rng.random(x.shape, dtype=np.float32) - rng.random(x.shape, dtype=np.float32))   # TPDF 디더
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


def mp3_frames(data: bytes):
    """MPEG-1 Layer III 프레임 헤더를 따라가며 (프레임 수, 초, 비트레이트 집합) 계산."""
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
        brs.add(br // 1000)
        flen = 144 * br // sr + pad
        frames += 1
        i += flen
    return frames, frames * 1152 / sr, brs


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


def spec_stats(seg):
    """(스펙트럼 중심 Hz, 8kHz 이상 에너지 비율 dB)."""
    mono = seg.mean(axis=0).astype(np.float64)
    nfft = 8192
    nfr = len(mono) // nfft
    P = np.zeros(nfft // 2 + 1)
    win = np.hanning(nfft)
    for i in range(0, nfr, 256):
        fr_ = mono[i * nfft: min(nfr, i + 256) * nfft].reshape(-1, nfft) * win[None, :]
        P += (np.abs(np.fft.rfft(fr_, axis=1)) ** 2).sum(axis=0)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    return float((P * fr).sum() / P.sum()), 10 * math.log10(max(P[fr >= 8000].sum() / P.sum(), 1e-12))


def analyze(x, log=print):
    res = {"sections": [], "sub": [], "windows": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    log("\n구간별 에너지")
    log("  구간  시간          RMS(dBFS)  피크(dBFS)  LUFS(근사)  중심(Hz)  ≥8k(dB)")
    for k, (name, b0) in enumerate(SECTIONS):
        t0, t1 = tb(b0), tb(bounds[k + 1])
        seg = x[:, int(t0 * SR):int(t1 * SR)]
        c, h8 = spec_stats(seg)
        row = dict(name=name, t0=t0, t1=t1, rms=db(math.sqrt(float((seg.astype(np.float64) ** 2).mean()))),
                   peak=db(float(np.abs(seg).max())), lufs=loudness(seg), cent=c, hf8=h8)
        res["sections"].append(row)
        log(f"  {name}    {mmss(t0)}～{mmss(t1)}    {row['rms']:7.2f}   {row['peak']:8.2f}   {row['lufs']:8.2f}   "
            f"{c:7.0f}  {h8:6.1f}")
    for s in SECS:
        b0 = SEC_START[s["n"]]
        seg = x[:, int(tb(b0) * SR):int(tb(b0 + s["bars"]) * SR)]
        c, h8 = spec_stats(seg)
        res["sub"].append(dict(name=s["n"], b0=b0, b1=b0 + s["bars"] - 1, t0=tb(b0), t1=tb(b0 + s["bars"]),
                               rms=db(math.sqrt(float((seg.astype(np.float64) ** 2).mean()))),
                               lufs=loudness(seg), cent=c, hf8=h8))
        log(f"    {s['n']:<8} {mmss(tb(b0))} LUFS {res['sub'][-1]['lufs']:7.2f}  중심 {c:5.0f}  ≥8k {h8:6.1f}")
    res["total_rms"] = db(math.sqrt(float((x.astype(np.float64) ** 2).mean())))
    res["peak"] = db(float(np.abs(x).max()))
    res["lufs"] = loudness(x)
    res["true_peak"] = db(true_peak(x))
    res["cent"], res["hf8"] = spec_stats(x)
    log(f"  전체  0:00～5:00    {res['total_rms']:7.2f}   {res['peak']:8.2f}   {res['lufs']:8.2f}   {res['cent']:7.0f}"
        f"  {res['hf8']:6.1f}   (트루피크 근사 {res['true_peak']:.2f} dBTP)")
    log("\n15초 창 RMS 곡선 (dBFS, ■ 1칸 = 1 dB, 기준 -40)")
    for w in range(20):
        seg = x[:, w * 15 * SR:(w + 1) * 15 * SR].astype(np.float64)
        r = db(math.sqrt(float((seg ** 2).mean())))
        tmid = w * 15 + 7.5
        sec = [n for n, b in SECTIONS if tb(b) <= tmid][-1]
        sub = [s["n"] for s in SECS if tb(SEC_START[s["n"]]) <= tmid][-1]
        res["windows"].append((w * 15, sec, sub, r))
        log(f"  {mmss(w * 15)} {sec} {sub:<8} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    jump = float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max())
    typ = float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max())
    a1 = x[:, -SR:].astype(np.float64)
    b1 = x[:, :SR].astype(np.float64)
    res["seam"] = dict(end50=db(math.sqrt((a ** 2).mean())), start50=db(math.sqrt((b ** 2).mean())),
                       end1s=db(math.sqrt((a1 ** 2).mean())), start1s=db(math.sqrt((b1 ** 2).mean())),
                       end3l=loudness(x[:, -3 * SR:]), start3l=loudness(x[:, :3 * SR]),
                       jump=jump, typ=typ, cent_end=spec_stats(x[:, -10 * SR:])[0],
                       cent_start=spec_stats(x[:, :10 * SR])[0])
    s = res["seam"]
    log(f"\n루프 이음매: 끝 50ms RMS {s['end50']:.2f} dBFS, 처음 50ms RMS {s['start50']:.2f} dBFS, "
        f"끝/처음 3초 LUFS {s['end3l']:.2f}/{s['start3l']:.2f}, "
        f"경계 샘플 차 {jump:.5f} (전형적 인접 샘플 차 최대 {typ:.5f})")
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
    fr = np.geomspace(30, 16000, 320)
    edges = np.searchsorted(fr_lin, np.sqrt(fr[:-1] * fr[1:]))
    edges = np.concatenate([[np.searchsorted(fr_lin, 30)], edges, [np.searchsorted(fr_lin, 16000)]])
    lo, hi = edges[:-1], np.maximum(edges[1:], edges[:-1] + 1)
    S = np.empty((nfr, len(fr)), dtype=np.float32)
    for i in range(0, nfr, 512):
        j = min(nfr, i + 512)
        idx = np.arange(nfft)[None, :] + hop * np.arange(i, j)[:, None]
        P = np.abs(np.fft.rfft(mono[idx] * win, axis=1)) ** 2
        cs = np.concatenate([np.zeros((P.shape[0], 1), np.float32), np.cumsum(P, axis=1)], axis=1)
        S[i:j] = np.sqrt((cs[:, hi] - cs[:, lo]) / (hi - lo))
    Sdb = 20 * np.log10(S.T + 1e-7)
    tt = (np.arange(nfr) * hop + nfft / 2) / SR
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 7.5), sharex=True, gridspec_kw={"height_ratios": [3, 1.2]})
    vmax = float(Sdb.max())
    ax1.pcolormesh(tt[::2], fr, Sdb[:, ::2], shading="auto", cmap="magma", vmin=vmax - 80, vmax=vmax)
    ax1.set_yscale("log")
    ax1.set_ylim(30, 16000)
    ax1.axhline(8000, color="#7fd", lw=0.7, ls=":", alpha=0.8)
    ax1.set_ylabel("주파수 (Hz)")
    ax1.set_title(f"{TITLE} — 스펙트로그램 (모노 합, {BPM} BPM, 300초, 점선 8 kHz)")
    win_s = 1.0
    nw = int(DUR / win_s)
    rms = [db(math.sqrt(float((x[:, int(i * win_s * SR):int((i + 1) * win_s * SR)].astype(np.float64) ** 2).mean())))
           for i in range(nw)]
    ax2.plot(np.arange(nw) * win_s + win_s / 2, rms, color="#2a6fdb", lw=1.2, label="1초 RMS")
    w15 = res["windows"]
    ax2.step([w[0] for w in w15] + [300], [w[3] for w in w15] + [w15[-1][3]], where="post", color="#e07b00", lw=1.4,
             label="15초 RMS")
    ax2.set_ylabel("RMS (dBFS)")
    ax2.set_xlabel("시간 (초)")
    ax2.set_ylim(min(rms) - 3, max(rms) + 3)
    ax2.grid(alpha=0.3)
    ax2.legend(loc="lower center", fontsize=8, ncol=2)
    for s in SECS:
        b = SEC_START[s["n"]]
        big = b in [x_ for _, x_ in SECTIONS]
        for ax in (ax1, ax2):
            ax.axvline(tb(b), color=("white" if ax is ax1 else "#555"), lw=1.0 if big else 0.5,
                       ls="--" if big else ":", alpha=0.85)
        ax1.text(tb(b) + 1, 14000, s["n"], color="white", fontsize=8 if not big else 10, va="top", rotation=90)
    ax1.set_xlim(0, DUR)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


DESC = {
    "인트로": "중음역 16분 펄스, 사각 플럭 아르페지오 A(처음 8마디는 8분), 닫힌 슈퍼소 패드, 비트 없음",
    "인트로 2": "점8분 엇박 플럭 아르페지오 B 겹침, 24마디부터 8분 셰이커(약하게), 28～31마디 첫 라이저",
    "그루브": "소프트 킥(4 온 더 플로어)·16분 롤링 베이스(킥 자리 비움)·오프비트 하이햇, 40마디부터 클랩 2·4박, 사이드체인",
    "빌드업": "화성 IV–V–vi–iii, 오프비트 벨 아르페지오 C·16분 셰이커 추가, 필터 서서히 열림",
    "빌드업 2": "테마 진행으로 전환, 메인 테마 예고(플럭 한 옥타브 아래 → 제자리), 76～79마디 라이저, 78～79마디 클랩 롤",
    "클라이맥스": "메인 테마(소프트 소 리드+플럭 옥타브 아래), 전 레이어, 필터 최대, 부드러운 저역 임팩트",
    "브레이크": "킥·베이스·하이햇 빠짐, 패드·아르페지오 위로 테마 첫 두 프레이즈를 플럭으로, 98～99마디 짧은 라이저",
    "드롭": "부드러운 드롭 — 리드 옥타브 겹침+플럭, 킥·베이스 복귀(임팩트 작게), 필터 최대",
    "정리": "리드·벨 C 빠짐, 124마디부터 클랩·셰이커 빠짐, 필터 닫히기 시작",
    "정리 2": "아르페지오 B 빠짐, 140마디부터 베이스·하이햇 빠짐, 144～147마디 킥 점점 약하게",
    "아웃트로": "펄스·아르페지오 A·패드만(152마디부터 8분), 필터 닫힘 → Esus4–E 에서 처음의 Aadd9 로 이어짐(루프)",
}


def write_report(path, res, stem_rms, info, gr, elapsed):
    L = []
    L.append(f"# {TITLE} — 작업 배경음악 합성 보고 (활동 단계 {STAGE})\n")
    L.append(f"- 생성: `compose_uplift.py` (seed {SEED}, numpy {np.__version__}), 실행 시간 {elapsed:.0f}초")
    L.append(f"- 형식: {SR} Hz 스테레오, {BITRATE} kbps CBR MP3, {BPM} BPM 4/4, {BARS}마디 = {DUR:.1f}초, {KEY_NAME}")
    L.append("- 성격: 멜로딕 프로그레시브 일렉트로닉, 외부 샘플·실존 곡 인용 없음(화음 진행·테마 자체 작곡, 악기 전부 합성)\n")
    L.append("## 곡 구조\n")
    L.append("| 큰 구간 | 세부 구간 | 시간 | 마디 | 화성 | 편성·전개 |")
    L.append("|---|---|---|---|---|---|")
    bigs = [s for _, s in SECTIONS]
    for s in SECS:
        b0 = SEC_START[s["n"]]
        big = [n for n, b in SECTIONS if b <= b0][-1]
        prog = []
        for c in PROGS[s["p"]][:s["bars"]]:
            if not prog or prog[-1] != c:
                prog.append(c)
        L.append(f"| {big} | {s['n']} | {mmss(tb(b0))}～{mmss(tb(b0 + s['bars']))} | {b0}～{b0 + s['bars'] - 1} | "
                 f"{' '.join(prog)} | {DESC[s['n']]} |")
    L.append("")
    L.append("- 클라이맥스 구간: 2:30～3:37(마디 80～115) — 클라이맥스 16마디 → 브레이크 4마디(7.5초) → 드롭 16마디")
    L.append("- 악기: 펄스(톱니 가산 플럭), 롤링 베이스(톱니+사인 서브, 사이드체인 55%), 플럭 아르페지오 A(사각)·B(톱니, 점8분)·"
             "C(사인 벨), 슈퍼소 패드(톱니 7개 ±19센트, LP 800↔3400 Hz), 소프트 소 리드(톱니 3개, LP 3.2 kHz), "
             "소프트 킥(110→45 Hz), 클랩(3탭 노이즈, 0.9～3.8 kHz), 하이햇·셰이커(3.6～6 kHz, 24 dB/oct), 노이즈 라이저, 저역 임팩트")
    L.append("- 이펙트·마스터: 점8분 핑퐁 딜레이(LP 2.8 kHz), 합성 IR 리버브, 킥 사이드체인, 밝기 자동화(필터 열림), "
             "9.5 kHz 완만한 LP, −16 LUFS 정규화, 룩어헤드 리미터, TPDF 디더\n")
    L.append("## 구간별 RMS·LUFS·스펙트럼\n")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) | 8 kHz 이상 에너지 (dB) |")
    L.append("|---|---|---:|---:|---:|---:|---:|")
    for r in res["sections"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['peak']:.2f} | {r['lufs']:.2f} | "
                 f"{r['cent']:.0f} | {r['hf8']:.1f} |")
    L.append(f"| **전체** | 0:00～5:00 | {res['total_rms']:.2f} | {res['peak']:.2f} | {res['lufs']:.2f} | {res['cent']:.0f} | "
             f"{res['hf8']:.1f} |")
    L.append("")
    L.append("세부 구간\n")
    L.append("| 세부 구간 | 시간 | RMS (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) | 8 kHz 이상 (dB) |")
    L.append("|---|---|---:|---:|---:|---:|")
    for r in res["sub"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['lufs']:.2f} | {r['cent']:.0f} | "
                 f"{r['hf8']:.1f} |")
    L.append("")
    L.append("악기 갈래별 RMS (마스터 이득 적용, 리버브·딜레이 제외, dBFS)\n")
    L.append("| 갈래 | " + " | ".join(n for n, _ in SECTIONS) + " |")
    L.append("|---|" + "---:|" * len(SECTIONS))
    for k, row in stem_rms.items():
        L.append(f"| {k} | " + " | ".join(("—" if v < -90 else f"{v:.1f}") for v in row) + " |")
    L.append("")
    L.append("## 15초 창 RMS 곡선\n")
    L.append("| 시작 | 구간 | 세부 | RMS (dBFS) | 곡선 (■ 1칸 = 1 dB, 기준 −40) |")
    L.append("|---|---|---|---:|---|")
    for t0, sec, sub, r in res["windows"]:
        L.append(f"| {mmss(t0)} | {sec} | {sub} | {r:.2f} | " + "■" * max(0, int(round(r + 40))) + " |")
    L.append("")
    s = res["seam"]
    L.append("## 루프 이음매\n")
    L.append("| 항목 | 값 |")
    L.append("|---|---|")
    L.append(f"| 끝 50ms RMS / 처음 50ms RMS | {s['end50']:.2f} / {s['start50']:.2f} dBFS (차 {abs(s['end50'] - s['start50']):.2f} dB) |")
    L.append(f"| 끝 1초 RMS / 처음 1초 RMS | {s['end1s']:.2f} / {s['start1s']:.2f} dBFS |")
    L.append(f"| 끝 3초 LUFS / 처음 3초 LUFS | {s['end3l']:.2f} / {s['start3l']:.2f} |")
    L.append(f"| 경계 샘플 차(끝→처음) | {s['jump']:.5f} (처음 1초 인접 샘플 차 최대 {s['typ']:.5f}) |")
    L.append(f"| 스펙트럼 중심 끝 10초 / 처음 10초 | {s['cent_end']:.0f} / {s['cent_start']:.0f} Hz |")
    L.append("| 방식 | 300초 원형 버퍼(끝을 넘는 음 꼬리·리버브·딜레이가 앞머리로 감김). 끝 12마디와 처음 16마디가 같은 편성"
             "(펄스·아르페지오 A 8분·패드)·같은 밝기(0.12)·같은 패드 레벨(0.45), 마지막 화음 E → 첫 화음 Aadd9(딸림→으뜸) |")
    L.append("| 한계 | MP3 인코더 지연·패딩(약 25～50ms)은 남으므로 `<audio loop>` 는 완전 무간격이 아님 |")
    L.append("")
    L.append("## 검사\n")
    L.append("| 항목 | 기준 | 결과 | 판정 |")
    L.append("|---|---|---|---|")
    for name, crit, val, ok in info["checks"]:
        L.append(f"| {name} | {crit} | {val} | {'통과' if ok else '실패'} |")
    L.append(f"\n리미터 최대 이득 감소 {gr:.2f} dB.\n")
    L.append("## 파일·해시\n")
    L.append("| 파일 | 크기 | SHA-256 |")
    L.append("|---|---|---|")
    for fn, size, h in info["files"]:
        L.append(f"| `{fn}` | {size:,} bytes | `{h}` |")
    L.append(f"\nPCM(16bit) SHA-256 `{info['pcm_sha']}`. 같은 환경에서 다시 실행하면 같은 해시가 나옵니다.")
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
    ap = argparse.ArgumentParser(description="'상승 기류' 작업 배경음악 합성")
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
            "sections": [{"name": s["n"], "start": round(tb(SEC_START[s["n"]]), 2)} for s in SECS], "seed": SEED,
            "title": TITLE, "mood": MOOD, "stage": STAGE, "energy": ENERGY}
    with open(jpath, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    png = os.path.join(od, "spectrogram.png")
    ta = time.time()
    spectrogram_png(mix, png, res)
    print(f"  스펙트로그램 {time.time() - ta:.0f}초")
    frames, secs, brs = mp3_frames(mp3)
    pcm_sha = hashlib.sha256(pcm.tobytes()).hexdigest()
    mp3_sha = hashlib.sha256(mp3).hexdigest()
    print(f"\nMP3: {out}")
    print(f"  크기 {len(mp3):,} bytes ({len(mp3)/1048576:.2f} MB), 프레임 {frames}, 길이 {secs:.3f}초, 비트레이트 {sorted(brs)}")
    print(f"  PCM sha256 {pcm_sha[:16]}…  MP3 sha256 {mp3_sha}")
    checks = [
        ("길이", "300±0.5초", f"{secs:.3f}초 ({frames} 프레임)", abs(secs - DUR) <= 0.5),
        ("PCM 길이", "정확히 300초", f"{pcm.shape[1]} 샘플 = {pcm.shape[1]/SR:.3f}초", pcm.shape[1] == N),
        ("크기", "8 MB 이하", f"{len(mp3)/1048576:.2f} MB", len(mp3) <= 8 * 1024 * 1024),
        ("비트레이트", "128 kbps CBR", "/".join(str(b) for b in sorted(brs)) + " kbps", brs == {BITRATE}),
        ("샘플 피크", "≤ −1.5 dBFS", f"{res['peak']:.2f} dBFS", res["peak"] <= -1.5),
        ("트루 피크(4× 근사)", "≤ −1.5 dBTP", f"{res['true_peak']:.2f} dBTP", res["true_peak"] <= -1.5),
        ("통합 라우드니스", "−16±0.5 LUFS", f"{res['lufs']:.2f} LUFS", abs(res["lufs"] - TARGET_LUFS) <= 0.5),
        ("8 kHz 이상 에너지", "≤ −30 dB(전체 대비)", f"{res['hf8']:.1f} dB", res["hf8"] <= -30.0),
    ]
    ok = all(c[3] for c in checks)
    elapsed = time.time() - t0
    files = [(os.path.basename(out), len(mp3), mp3_sha), (os.path.basename(jpath), os.path.getsize(jpath), sha(jpath)),
             ("spectrogram.png", os.path.getsize(png), sha(png)),
             ("compose_uplift.py", os.path.getsize(os.path.abspath(__file__)), sha(os.path.abspath(__file__)))]
    write_report(os.path.join(od, "report.md"), res, stem_rms, {"checks": checks, "files": files, "pcm_sha": pcm_sha},
                 gr, elapsed)
    for c in checks:
        print(f"  {c[0]}: {c[2]} ({c[1]}) {'통과' if c[3] else '실패'}")
    print(f"  검사: {'통과' if ok else '실패'}  (실행 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
