#!/usr/bin/env python3
"""'야간 주행' 작업 배경음악 결정적 합성기 (활동 단계 2 · 활발).

부드러운 신스웨이브/드라이브. 외부 샘플 없이 numpy 로 전부 합성한다(자체 작곡, 실존 곡 인용 없음).
마스터링·원형 루프·검사·MP3 부분은 music/compose_city.py(← compose.py)를 복사해 재사용했다.

구조: 108 BPM, 4/4, 135마디 = 300초, A minor ↔ C major(관계장조).
  기  0:00～0:36  (마디   0～15)  코러스 패드·8분 아르페지오, 비트 없음 → 낮은 서브 근음
  승  0:36～2:29  (마디  16～66)  소프트 킥·옥타브 8분 베이스 진입 → 게이트 스네어·오프비트 햇,
                                  C장조 쪽 B, 모티프 예고, 3마디 빌드(Dm–E)
  전  2:29～3:40  (마디  67～98)  사각파 리드 모티프(비브라토) 2회, 두 번째는 옥타브 아래 겹침, 밝기 최대
  결  3:40～5:00  (마디  99～134) 드럼 빠짐, 모티프 회상 → 베이스 성기게 → 패드·아르페지오만 남아 G 에서 처음의 Am 으로

루프: 모든 꼬리·리버브·딜레이·코러스는 300초 원형 버퍼에서 앞머리로 감긴다. 처음과 끝은 같은 편성(패드+아르페지오)·
같은 밝기·같은 마스터 레벨이고, 마지막 화음 G → 첫 화음 Am 으로 이어진다. 코러스 LFO 는 300초에 정수 주기.

사용법:
  python compose_drive.py --out bgm-drive.mp3 [--wav 미리듣기.wav]
  (같은 폴더에 bgm-drive.json, report.md, spectrogram.png 도 만든다)
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

SEED = 1088
SR = 44100
BPM = 108
BEAT = 60.0 / BPM            # 0.5556 s
ST = BEAT / 4                # 16분음표
BAR = 4 * BEAT               # 2.2222 s
BARS = 135
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -1.5               # 샘플 피크 상한
BITRATE = 128
SECTIONS = [("기", 0), ("승", 16), ("전", 67), ("결", 99)]
TITLE = "야간 주행"
MOOD = "부드러운 신스웨이브 드라이브 — 옥타브 8분 베이스, 코러스 폴리신스 패드, 아르페지오, 소프트 사각파 리드, 둥근 게이트 스네어"
KEY_NAME = "A minor"
STAGE = 2
ENERGY = 0.65

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "bgm-drive.mp3")

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


# ───────────────────────── 씨앗 난수 (마디별 작은 변주용, mulberry32 · FNV-1a) ─────────────────────────

M32 = 0xFFFFFFFF


def _imul(a, b):
    return (a * b) & M32


def mulberry(a):
    st = [a & M32]

    def r():
        a_ = (st[0] + 0x6D2B79F5) & M32
        st[0] = a_
        t = _imul(a_ ^ (a_ >> 15), 1 | a_)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296.0
    return r


def hash_str(s: str) -> int:
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = _imul(h, 16777619)
    return h & M32


def rng_of(*k):
    return mulberry(hash_str("|".join(str(x) for x in k)))


# ───────────────────────── 화음 ─────────────────────────

def mod12(n):
    return n % 12


NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"": [0, 4, 7], "m": [0, 3, 7], "m7": [0, 3, 7, 10], "maj7": [0, 4, 7, 11], "add9": [0, 4, 7, 14],
        "6": [0, 4, 7, 9]}


def pc_of(s):
    acc = 1 if len(s) > 1 and s[1] == "#" else -1 if len(s) > 1 and s[1] == "b" else 0
    return mod12(NOTE_PC[s[0]] + acc)


_CC = {}


def chord_p(name):
    if name in _CC:
        return _CC[name]
    acc = 2 if len(name) > 1 and name[1] in "#b" else 1
    iv = QUAL[name[acc:]]
    r = pc_of(name)
    ch = {"name": name, "r": r, "iv": iv, "pcs": [mod12(r + x) for x in iv]}
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


def voicing(ch, center, n):
    iv = ch["iv"]
    pri = [0] + [iv[i] for i in (1, 3, 2) if i < len(iv)]
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

CYC = "Am Am F F C C G G".split()
CHORDS = (CYC * 2                                              # 기    0～15
          + CYC * 2                                            # A     16～31
          + "C C G G Am Am F F Dm Dm F F G G E E".split()      # B     32～47 (관계장조 C 쪽)
          + CYC * 2                                            # A2    48～63
          + "Dm Dm E".split()                                  # 빌드  64～66
          + "F F G G Am Am C C F F G G C C E E".split()        # C     67～82
          + "F F G G Am Am C C F F G G Am Am E E".split()      # C2    83～98
          + CYC * 4 + "F F G G".split())                       # 결    99～134
assert len(CHORDS) == BARS, len(CHORDS)
COLOR = {"Am": "Am7", "F": "Fmaj7", "C": "Cadd9", "G": "G6", "Dm": "Dm7", "E": "E"}

SECS = [
    dict(n="인트로", bars=8, on="pad arp"),
    dict(n="인트로 2", bars=8, on="pad arp sub"),
    dict(n="A · 드럼 진입", bars=16, on="pad arp obass kick snare8 hat8"),
    dict(n="B · 관계장조", bars=16, on="pad arp obass kick snare hat arp2"),
    dict(n="A2 · 모티프 예고", bars=16, on="pad arp obass kick snare hat tease2"),
    dict(n="빌드", bars=3, on="pad arp obass kick snare hat riser"),
    dict(n="C · 클라이맥스", bars=16, on="pad arp obass kick snare hat lead arp2"),
    dict(n="C2 · 클라이맥스", bars=16, on="pad arp obass kick snare hat lead dbl arp2 ghost"),
    dict(n="결 · 드럼 빠짐", bars=16, on="pad arp obass kfade tease1"),
    dict(n="결 2", bars=12, on="pad arp bhalf"),
    dict(n="결 끝", bars=8, on="pad arp"),
]
BIG = ["기", "기", "승", "승", "승", "승", "전", "전", "결", "결", "결"]
DESC = {
    "인트로": "코러스 폴리신스 패드 + 8분 아르페지오(필터 닫힘), 비트 없음",
    "인트로 2": "아르페지오 밝아짐, 마디마다 낮은 서브 근음",
    "A · 드럼 진입": "소프트 킥 1·3박, 옥타브 8분 베이스 진입, 8마디부터 둥근 게이트 스네어 2·4박·오프비트 햇",
    "B · 관계장조": "C장조 쪽 진행(C–G–Am–F–Dm–F–G–E), 아르페지오 음형 변주, 가끔 당김 킥",
    "A2 · 모티프 예고": "Am 진행 복귀, 뒤 8마디에 리드 모티프를 작게 예고",
    "빌드": "Dm7–E, 노이즈 상승(작게), 마지막 마디 스네어 8분 크레셴도",
    "C · 클라이맥스": "소프트 사각파 리드 모티프(지연 비브라토) F–G–Am–C–F–G–C–E, 필터 열림",
    "C2 · 클라이맥스": "모티프 변주(끝을 Am 으로), 옥타브 아래 겹침, 16분 고스트 햇, 밝기 최대, 끝에 탐 필",
    "결 · 드럼 빠짐": "스네어·햇 빠지고 킥은 4마디에 걸쳐 사라짐, 모티프 회상(점점 작게)",
    "결 2": "베이스가 2분음표로 성기게, 패드·아르페지오",
    "결 끝": "패드·아르페지오만(처음과 같은 편성), F–G 에서 처음의 Am 으로 이어짐(루프)",
}
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
assert [SEC_START[SECS[i]["n"]] for i in (0, 2, 6, 8)] == [b for _, b in SECTIONS]

# 리드 모티프(자체 작곡): 2마디 덩어리, (16분 시작, 16분 길이, MIDI)
CHUNK = {
    "F":   [(0, 6, 69), (6, 2, 72), (8, 8, 76), (16, 4, 74), (20, 4, 72), (24, 8, 69)],
    "G":   [(0, 6, 71), (6, 2, 74), (8, 8, 76), (16, 4, 74), (20, 4, 71), (24, 8, 67)],
    "Am":  [(0, 6, 72), (6, 2, 76), (8, 12, 81), (20, 4, 79), (24, 8, 76)],
    "C":   [(0, 8, 76), (8, 4, 74), (12, 4, 72), (16, 16, 67)],
    "F2":  [(0, 6, 69), (6, 2, 72), (8, 8, 77), (16, 4, 76), (20, 4, 72), (24, 8, 69)],
    "C2":  [(0, 6, 76), (6, 2, 79), (8, 8, 76), (16, 4, 74), (20, 4, 72), (24, 8, 72)],
    "Am2": [(0, 6, 72), (6, 2, 76), (8, 8, 81), (16, 4, 79), (20, 4, 76), (24, 8, 72)],
    "E":   [(0, 12, 71), (12, 4, 68), (16, 16, 71)],
}
LEAD_KEYS = {"C · 클라이맥스": ["F", "G", "Am", "C", "F2", "G", "C2", "E"],
             "C2 · 클라이맥스": ["F", "G", "Am", "C", "F2", "G", "Am2", "E"]}
TEASE_KEYS = ["Am", "F", "C", "G"]
ARP_P1 = [0, 1, 2, 3, 4, 3, 2, 1]
ARP_P2 = [0, 2, 1, 3, 2, 4, 3, 1]


def arp_tones(ch):
    root = bass_note(ch["r"], 52)
    t = sorted(set([root + x for x in ch["iv"]] + [root + 12]))
    while len(t) < 5:
        t.append(t[1] + 12)
    return t[:5]


def gen_bar(bi):
    si, bl = MAP[bi]
    sec = SECS[si]
    on = sec["on"]
    ch = chord_p(COLOR[CHORDS[bi]])
    r = rng_of("drive", "bar", bi)
    ev = []

    def E(s, ins, m, l, v, pan=0.0):
        ev.append({"s": s, "ins": ins, "m": m, "l": l, "v": v, "pan": pan})

    if "arp" in on:
        tones = arp_tones(ch)
        pat = ARP_P2 if ("arp2" in on and bi % 2) else ARP_P1
        for k in range(8):
            E(2 * k, "arp", tones[pat[k]], 2, 0.07 * (1.0 if k % 2 == 0 else 0.8), -0.3 if k % 2 == 0 else 0.3)
    lo = bass_note(ch["r"], 33)
    if "obass" in on:
        bv = 1.0 - (0.03 * bl if "kfade" in on else 0.0)
        for k in range(8):
            E(2 * k, "obass", lo + (12 if k % 2 else 0), 1.6, (0.2 if k % 2 == 0 else 0.14) * bv)
    if "bhalf" in on:
        E(0, "obass", lo, 7, 0.15)
        E(8, "obass", lo, 7, 0.11)
    if "sub" in on:
        E(0, "obass", lo, 14, 0.11)
    kfade = "kfade" in on and bl < 4
    if "kick" in on or kfade:
        kv = 1.0 if "kick" in on else 0.8 - 0.18 * bl
        E(0, "kick", 0, 1, 0.26 * kv)
        E(8, "kick", 0, 1, 0.22 * kv)
        if "arp2" in on and r() < 0.3:
            E(10, "kick", 0, 1, 0.11)
    build_end = sec["n"] == "빌드" and bl == sec["bars"] - 1
    if "snare" in on or ("snare8" in on and bl >= 8):
        E(4, "snare", 0, 1, 0.09, 0.05)
        if build_end:
            for j, s in enumerate((8, 10, 12, 13, 14, 15)):
                E(s, "snare", 0, 1, 0.035 + 0.009 * j, 0.05)
        else:
            E(12, "snare", 0, 1, 0.09, 0.05)
    if "hat" in on or ("hat8" in on and bl >= 8):
        for s in (2, 6, 10, 14):
            E(s, "hat", 0, 1, 0.03, 0.25)
        if "ghost" in on:
            for s in (3, 7, 11, 15):
                if r() < 0.6:
                    E(s, "hat", 0, 1, 0.011, -0.2)
    if sec["n"].startswith("C2") and bl == sec["bars"] - 1:
        for s, m in [(12, 52), (13, 50), (14, 47), (15, 45)]:
            E(s, "tom", m, 1, 0.085, 0.3 - 0.2 * (s - 12))
    if "lead" in on:
        key = LEAD_KEYS[sec["n"]][bl // 2]
        off = (bl % 2) * 16
        for s, l, m in CHUNK[key]:
            if off <= s < off + 16:
                E(s - off, "lead", m, l, 0.075, 0.1)
                if "dbl" in on:
                    E(s - off, "lead", m - 12, l, 0.032, -0.15)
    tease = ("tease2" in on and bl >= 8) or ("tease1" in on and bl < 8)
    if tease:
        key = TEASE_KEYS[(bl % 8) // 2]
        off = (bl % 2) * 16
        tv = 0.045 if "tease2" in on else 0.05 * (1.0 - 0.07 * bl)
        for s, l, m in CHUNK[key]:
            if off <= s < off + 16:
                E(s - off, "lead", m, l, tv, 0.1)
    for e in ev:
        jitter = 0.0 if e["ins"] in ("arp", "obass") else (r() - 0.5) * 0.006
        e["t"] = tb(bi) + e["s"] * ST + jitter
        e["d"] = e["l"] * ST
        e["bar"] = bi
    return ev


def build_events():
    ev = []
    for bi in range(BARS):
        ev.extend(gen_bar(bi))
    # 패드: 화음이 바뀌는 곳마다 한 번, 같은 화음이 이어지는 마디 수만큼 길게
    for bi in range(BARS):
        if CHORDS[bi] != CHORDS[bi - 1]:
            run = 1
            while bi + run < BARS and CHORDS[bi + run] == CHORDS[bi]:
                run += 1
            ch = chord_p(COLOR[CHORDS[bi]])
            for j, m in enumerate(voicing(ch, 60, 4)):
                ev.append({"s": 0, "ins": "pad", "m": m, "l": run * 16, "v": 0.024, "pan": -0.5 + j / 3.0,
                           "t": tb(bi), "d": run * BAR, "bar": bi})
    return ev


# ───────────────────────── 악기 (고음·트랜지언트를 누그러뜨린 합성) ─────────────────────────

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


def partials(f, dur, v, parts, wave="sine", att=0.004, gate_tau=0.05):
    dur = max(dur, 0.05)
    L = max(min(dur + 0.3, tau * 5 + 0.02) for _, _, tau in parts) + 0.03
    n = int(L * SR)
    t = _t(n)
    y = np.zeros(n)
    for k, vol, tau in parts:
        fk = f * k
        if fk > 9000:
            continue
        e = np.where(t < att, t / att, np.exp(-(t - att) / tau))
        ed = math.exp(-(dur - att) / tau)
        e = np.where(t >= dur, ed * np.exp(-(t - dur) / gate_tau), e)
        if wave == "triangle":
            osc = np.zeros(n)
            for h in (1, 3, 5, 7):
                if fk * h < 6000:
                    osc += ((-1) ** ((h - 1) // 2)) * np.sin(2 * np.pi * fk * h * t) / (h * h)
            osc *= 8 / np.pi ** 2
        else:
            osc = np.sin(2 * np.pi * fk * t)
        y += v * vol * e * osc
    return _fade_tail(y).astype(F32)


def _fade_tail_st(y, ms=6):
    k = min(y.shape[1], int(ms * SR / 1000))
    y[:, -k:] *= np.linspace(1, 0, k)[None, :]
    return y


def ins_arp(f, dur, v):
    """소프트 플럭: 사각파 홀수 배음을 빨리 닫히는 저역 통과(f*5 → f*1.5)로 근사, 상한 6kHz."""
    rel = 0.08
    n = int((dur + rel * 5) * SR)
    t = _t(n)
    fc = f * 1.5 + (min(4500.0, f * 5) - f * 1.5) * np.exp(-t / 0.08)
    y = np.zeros(n)
    for h in range(1, 30, 2):
        fh = f * h
        if fh > 6000:
            break
        y += (4 / np.pi) / h * np.sin(2 * np.pi * fh * t) / np.sqrt(1 + (fh / fc) ** 4)
    env = env_target(t, 0.006, v, 0.2, 0.25, dur, rel)
    return _fade_tail(y * env * 0.7).astype(F32)


def ins_lead(f, dur, v):
    """소프트 사각파 리드: 홀수 배음 1/h(완만한 저역 통과), 0.18초 뒤 서서히 들어오는 5.2Hz 비브라토(±10센트)."""
    rel = 0.2
    n = int((dur + rel * 5) * SR)
    t = _t(n)
    depth = 0.006 * np.clip((t - 0.18) / 0.3, 0, 1)
    finst = f * (1 + depth * np.sin(2 * np.pi * 5.2 * t))
    ph = 2 * np.pi * np.cumsum(finst) / SR
    fc = max(1600.0, f * 3)
    y = np.zeros(n)
    for h in range(1, 20, 2):
        fh = f * h
        if fh > 5000:
            break
        y += np.sin(h * ph) / h / np.sqrt(1 + (fh / fc) ** 4)
    y += 0.12 * np.sin(2 * ph) / np.sqrt(1 + (2 * f / fc) ** 4)    # 약간의 짝수 배음(펄스폭 살짝 비대칭)
    env = env_target(t, 0.02, v, 0.7, 0.78, dur, rel)
    return _fade_tail(y * env * 0.8).astype(F32)


def ins_pad(f, dur, v):
    """폴리신스 패드: 채널마다 디튠 톱니파 둘(±센트), 느린 어택·긴 릴리스. 코러스는 버스에서."""
    rel = 1.1
    n = int((dur + rel * 5) * SR)
    t = _t(n)
    env = env_target(t, 0.6, v, 2.5, 0.88, dur, rel)
    out = np.zeros((2, n))
    for ch, cents in enumerate(((-8.0, 3.0), (-3.0, 8.0))):
        s = np.zeros(n)
        for c in cents:
            s += polyblep_saw(f * 2 ** (c / 1200), n, rng.random())
        out[ch] = s * env * 0.5
    return _fade_tail_st(out).astype(F32)


def ins_obass(f, dur, v):
    """옥타브 베이스: 톱니파 + 사인 서브, 4ms 어택·짧은 감쇠, 대역은 버스에서 저역 통과."""
    rel = 0.06
    n = int((dur + 0.4) * SR)
    t = _t(n)
    y = 0.55 * polyblep_saw(f, n, 0.0) + 0.65 * np.sin(2 * np.pi * f * t)
    env = env_target(t, 0.004, v, 0.22, 0.35, dur, rel)
    return _fade_tail(y * env).astype(F32)


def ins_kick(v):
    # 소프트 킥: 100 → 44 Hz, 감쇠 τ 0.13, 클릭 없이 3ms 어택
    n = int(0.65 * SR)
    t = _t(n)
    f = 44 * (100 / 44) ** np.exp(-t / 0.05)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.minimum(t / 0.003, 1) * np.exp(-t / 0.13)
    return _fade_tail(np.sin(ph) * e * v).astype(F32)


def ins_tom(f, v):
    n = int(0.7 * SR)
    t = _t(n)
    ff = f * (0.72 + 0.28 * np.exp(-t / 0.13))
    ph = 2 * np.pi * np.cumsum(ff) / SR
    e = np.minimum(t / 0.004, 1) * np.exp(-t / 0.15)
    return _fade_tail(np.sin(ph) * e * v).astype(F32)


def ins_snare(v):
    """둥근 스네어: 175Hz 몸통 + 노이즈(3ms 어택). 대역 제한·게이트 리버브는 버스에서."""
    n = int(0.4 * SR)
    t = _t(n)
    fb = 170 + 45 * np.exp(-t / 0.012)
    body = np.sin(2 * np.pi * np.cumsum(fb) / SR) * np.minimum(t / 0.002, 1) * np.exp(-t / 0.055)
    nz = rng.standard_normal(n) * np.minimum(t / 0.003, 1) * np.exp(-t / 0.085)
    return _fade_tail((0.6 * body + 0.4 * nz) * v).astype(F32)


def ins_noise(v, dur, att):
    n = int((att + dur * 1.7) * SR) + 32
    t = _t(n)
    e = np.where(t < att, t / att, np.exp(-(t - att) / (dur / 3)))
    return _fade_tail(rng.standard_normal(n) * e * v).astype(F32)


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


def gated_ir(length=0.24):
    """80년대식 게이트 리버브: 촘촘한 노이즈 꼬리를 0.24초에서 닫는다(닫힘 30ms, 저역 통과 3.2kHz)."""
    n = int(length * SR)
    t = np.arange(n) / SR
    env = (1 - np.exp(-t / 0.004)) * np.exp(-t / 0.4)
    k = int(0.03 * SR)
    env[-k:] *= np.linspace(1, 0, k) ** 2
    ir = rng.standard_normal((2, n)) * env[None, :]
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * (lp_mag(fr, 3200, 1) * hp_mag(fr, 250, 1)), n=n, axis=1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


def chorus(x, base_ms=13.0, depth_ms=3.0, cycles=120, dry=0.62, wet=0.3):
    """원형 2탭 코러스: 지연 LFO 0.4Hz(300초에 정확히 120주기), 탭 둘은 반대 위상, 오른쪽은 90° 어긋남."""
    out = np.empty_like(x)
    blk = 1 << 20
    for ch in range(2):
        for a in range(0, N, blk):
            b = min(N, a + blk)
            i = np.arange(a, b, dtype=np.float64)
            ph = 2 * np.pi * cycles * i / N + ch * np.pi / 2
            acc = dry * x[ch, a:b].astype(np.float64)
            for sgn in (1.0, -1.0):
                d = (base_ms + sgn * depth_ms * np.sin(ph)) * SR / 1000.0
                pos = i - d
                i0 = np.floor(pos)
                fr = pos - i0
                i0 = i0.astype(np.int64) % N
                i1 = (i0 + 1) % N
                acc += wet * (x[ch, i0] * (1 - fr) + x[ch, i1] * fr)
            out[ch, a:b] = acc
    return out


# ───────────────────────── 조립 ─────────────────────────

_SYN = {}


def cached(ins, m, d, fn):
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


def stereo_bus(events, name, fn, width=1.41):
    bus = new_bus()
    for e in events:
        if e["ins"] == name:
            sig = cached(name, e["m"], e["d"], fn) * F32(e["v"])
            gl_, gr_ = pan_gains(e["pan"])
            sig[0] *= gl_ * width
            sig[1] *= gr_ * width
            add(bus, e["t"], sig)
    return bus


def sec_rms(x):
    """갈래 버스의 큰 구간별 RMS(dB, 마스터 이득 전). 버스 배열을 붙들지 않아 메모리를 아낀다."""
    bounds = [b for _, b in SECTIONS] + [BARS]
    row = []
    for k in range(len(SECTIONS)):
        seg = x[:, int(tb(bounds[k]) * SR):int(tb(bounds[k + 1]) * SR)].astype(np.float64)
        row.append(20 * math.log10(max(math.sqrt(float((seg ** 2).mean())), 1e-12)))
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

    # 킥·탐 + 사이드체인 트리거
    kbus = new_bus()
    trig = np.zeros(N, dtype=F32)
    for e in events:
        if e["ins"] == "kick":
            add(kbus, e["t"], ins_kick(e["v"]))
            trig[int(round(e["t"] * SR)) % N] += e["v"]
        elif e["ins"] == "tom":
            add(kbus, e["t"], ins_tom(mtof(e["m"]), e["v"]), e["pan"])
    duck = sidechain(trig)
    kbus = fd_filter(kbus, hp_mag(f, 32, 2) * lp_mag(f, 2200, 2))
    kbus *= 0.74
    stems["kick·tom"] = sec_rms(kbus)
    mix += kbus
    rev_send += 0.04 * kbus
    del kbus, trig
    st("kick")

    # 스네어 + 게이트 리버브 (둥글게·작게)
    sn = render_bus(events, {"snare"}, lambda e: ins_snare(e["v"]))
    sn = fd_filter(sn, hp_mag(f, 140, 2) * lp_mag(f, 3800, 2))
    gate = circ_conv(sn, gated_ir())
    sn += 0.32 * gate
    del gate
    sn *= 1.5
    stems["snare(게이트)"] = sec_rms(sn)
    mix += sn
    rev_send += 0.1 * sn
    del sn
    st("snare")

    hh = render_bus(events, {"hat"}, lambda e: ins_noise(e["v"], 0.03, 0.002))
    hh = fd_filter(hh, hp_mag(f, 4800, 2) * lp_mag(f, 7800, 3))
    hh *= 2.0
    stems["hat"] = sec_rms(hh)
    mix += hh
    rev_send += 0.2 * hh
    del hh

    # 빌드 노이즈 상승(작게)
    rs = new_bus()
    n_r = int(3 * BAR * SR)
    ramp = np.linspace(0, 1, n_r) ** 2.5
    ramp[-int(0.06 * SR):] *= np.linspace(1, 0, int(0.06 * SR))
    add(rs, tb(64), (rng.standard_normal((2, n_r)) * ramp[None, :] * 0.022).astype(F32))
    rs = fd_filter(rs, hp_mag(f, 400, 2) * lp_mag(f, 3000, 2))
    stems["riser"] = sec_rms(rs)
    mix += rs
    rev_send += 0.5 * rs
    del rs, ramp
    st("hat·riser")

    # 밝기 자동화: 기·결은 어둡게, 전에서 가장 밝게 (처음·끝 값 같음 → 루프 연속)
    bright = automation([(0, 0.22), (8, 0.32), (16, 0.42), (32, 0.55), (48, 0.5), (64, 0.62), (67, 0.8),
                         (83, 0.88), (91, 1.0), (99, 0.65), (115, 0.4), (127, 0.26), (135, 0.22)])

    pad = stereo_bus(events, "pad", ins_pad)
    _SYN.clear()
    pad = chorus(pad)
    hp = hp_mag(f, 110, 1)
    pad = fd_split(pad, hp * lp_mag(f, 850, 2), hp * lp_mag(f, 3000, 2), bright)
    pad *= (0.68 + 0.32 * duck)[None, :]
    pad *= 1.3
    stems["pad"] = sec_rms(pad)
    mix += pad
    rev_send += 0.45 * pad
    del pad
    st("pad (chorus)")

    ar = render_bus(events, {"arp"}, lambda e: cached("arp", e["m"], e["d"], ins_arp) * F32(e["v"]))
    _SYN.clear()
    hp = hp_mag(f, 160, 1)
    ar = fd_split(ar, hp * lp_mag(f, 1500, 2), hp * lp_mag(f, 4500, 1), bright)
    ar *= (0.85 + 0.15 * duck)[None, :]
    ar *= 1.3
    stems["arp"] = sec_rms(ar)
    mix += ar
    rev_send += 0.3 * ar
    echo_send += 0.28 * ar
    del ar
    st("arp")

    ld = render_bus(events, {"lead"}, lambda e: cached("lead", e["m"], e["d"], ins_lead) * F32(e["v"]))
    _SYN.clear()
    hp = hp_mag(f, 200, 1)
    ld = fd_split(ld, hp * lp_mag(f, 2400, 2), hp * lp_mag(f, 4200, 2), bright)
    ld *= 1.05
    stems["lead"] = sec_rms(ld)
    mix += ld
    rev_send += 0.42 * ld
    echo_send += 0.32 * ld
    del ld
    st("lead")

    bs = render_bus(events, {"obass"}, lambda e: cached("obass", e["m"], e["d"], ins_obass) * F32(e["v"]))
    _SYN.clear()
    bs = fd_split(bs, hp_mag(f, 34, 2) * lp_mag(f, 420, 2), hp_mag(f, 34, 2) * lp_mag(f, 900, 2), bright)
    bs *= (0.6 + 0.4 * duck)[None, :]
    bs *= 0.6
    stems["bass"] = sec_rms(bs)
    mix += bs
    rev_send += 0.04 * bs
    del bs, duck
    st("bass")

    echo = circ_conv(echo_send.mean(axis=0), echo_ir())
    mix += 0.42 * echo
    rev_send += 0.35 * echo
    del echo, echo_send
    st("echo")
    wet = circ_conv(rev_send, reverb_ir())
    wet = fd_filter(wet, hp_mag(f, 160, 1) * lp_mag(f, 6500, 1))
    mix += 0.3 * wet
    del wet, rev_send
    st("reverb")

    # 마스터: 처음과 끝을 같은 수준으로(패드+아르페지오 ↔ 패드+아르페지오) 루프 이음매 연속
    mix *= automation([(0, 0.92), (2, 1.0), (132, 1.0), (135, 0.92)])[None, :]
    # 초저역 정리 + 고역을 완만히 눌러 날카로움 방지
    mix = fd_filter(mix, hp_mag(f, 28, 2) * lp_mag(f, 10000, 1))

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


def hf_ratio(seg, fc=8000.0):
    """fc 이상 대역 에너지 / 전체 에너지 (dB)."""
    mono = seg.mean(axis=0).astype(np.float64)
    nfft = 8192
    nfr = len(mono) // nfft
    frames = mono[: nfr * nfft].reshape(nfr, nfft) * np.hanning(nfft)[None, :]
    P = (np.abs(np.fft.rfft(frames, axis=1)) ** 2).sum(axis=0)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    return 10 * math.log10(max(float(P[fr >= fc].sum()), 1e-30) / float(P.sum()))


def crest(seg):
    """15초 창 단위 평균 크레스트 팩터(피크/RMS, dB) — 트랜지언트 정도의 지표."""
    return db(float(np.abs(seg).max())) - db(math.sqrt(float((seg.astype(np.float64) ** 2).mean())))


def analyze(x, log=print):
    res = {"sections": [], "sub": [], "windows": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    log("\n구간별 에너지")
    log("  구간  시간          RMS(dBFS)  피크(dBFS)  LUFS(근사)  중심(Hz)  8k↑(dB)")
    for k, (name, b0) in enumerate(SECTIONS):
        t0, t1 = tb(b0), tb(bounds[k + 1])
        seg = x[:, int(t0 * SR):int(t1 * SR)].astype(np.float64)
        row = dict(name=name, t0=t0, t1=t1, bars=(b0, bounds[k + 1] - 1),
                   rms=db(math.sqrt(float((seg ** 2).mean()))), peak=db(float(np.abs(seg).max())),
                   lufs=loudness(seg), cent=centroid(seg), hf=hf_ratio(seg))
        res["sections"].append(row)
        log(f"  {name}    {mmss(t0)}～{mmss(t1)}    {row['rms']:7.2f}   {row['peak']:8.2f}   {row['lufs']:8.2f}"
            f"   {row['cent']:7.0f}   {row['hf']:6.1f}")
    for s in SECS:
        b0 = SEC_START[s["n"]]
        seg = x[:, int(tb(b0) * SR):int(tb(b0 + s["bars"]) * SR)]
        res["sub"].append(dict(name=s["n"], b0=b0, b1=b0 + s["bars"] - 1, t0=tb(b0), t1=tb(b0 + s["bars"]),
                               rms=db(math.sqrt(float((seg.astype(np.float64) ** 2).mean()))),
                               lufs=loudness(seg), cent=centroid(seg), hf=hf_ratio(seg)))
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
        res["windows"].append((w * 15, sec, r, crest(seg)))
        log(f"  {mmss(w * 15)} {sec} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    jump = float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max())
    typ = float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max())
    a1 = x[:, -SR:].astype(np.float64)
    b1 = x[:, :SR].astype(np.float64)
    res["seam"] = dict(end50=db(math.sqrt((a ** 2).mean())), start50=db(math.sqrt((b ** 2).mean())),
                       end1s=db(math.sqrt((a1 ** 2).mean())), start1s=db(math.sqrt((b1 ** 2).mean())),
                       jump=jump, typ=typ, cent_end=centroid(x[:, -10 * SR:]), cent_start=centroid(x[:, :10 * SR]))
    s = res["seam"]
    log(f"\n루프 이음매: 끝 50ms RMS {s['end50']:.2f} dBFS, 처음 50ms RMS {s['start50']:.2f} dBFS, "
        f"경계 샘플 차 {jump:.5f} (전형적 인접 샘플 차 최대 {typ:.5f})")
    return res


def write_report(path, res, stem_rms, mp3_info, gr, elapsed):
    L = []
    L.append(f"# {TITLE} — 작업 배경음악 합성 보고\n")
    L.append(f"- 생성: `compose_drive.py` (seed {SEED}, numpy {np.__version__}), 실행 시간 {elapsed:.0f}초")
    L.append(f"- 형식: {SR} Hz 스테레오, {BITRATE} kbps CBR MP3, {BPM} BPM 4/4, {BARS}마디 = {DUR:.1f}초, "
             f"A minor ↔ C major(관계장조)")
    L.append(f"- 용도: 활동 단계 {STAGE}(활발), energy {ENERGY}. 부드러운 신스웨이브 드라이브, 자체 작곡(외부 샘플·실존 곡 인용 없음)")
    L.append("- 악기: 코러스 폴리신스 패드(디튠 톱니파 ×2/채널 + 2탭 원형 코러스), 소프트 플럭 아르페지오(점8분 핑퐁 딜레이), "
             "옥타브 8분 베이스(톱니+사인, 킥 사이드체인), 소프트 킥, 둥근 게이트 리버브 스네어(3.8kHz 저역 통과), "
             "오프비트 햇(4.8～7.8kHz 대역), 소프트 사각파 리드(지연 비브라토 5.2Hz ±10센트)\n")
    L.append("## 곡 구조\n")
    L.append("| 큰 구간 | 세부 구간 | 시간 | 마디 | 화음 진행 | 편성 |")
    L.append("|---|---|---|---|---|---|")
    for i, s in enumerate(SECS):
        b0 = SEC_START[s["n"]]
        seq = CHORDS[b0:b0 + s["bars"]]
        prog = []
        for c in seq:
            if not prog or prog[-1] != c:
                prog.append(c)
        L.append(f"| {BIG[i]} | {s['n']} | {mmss(tb(b0))}～{mmss(tb(b0 + s['bars']))} | {b0}～{b0 + s['bars'] - 1} | "
                 f"{'–'.join(prog)} | {DESC[s['n']]} |")
    L.append("")
    L.append("화음 색: Am→Am7, F→Fmaj7, C→Cadd9, G→G6, Dm→Dm7, E→E(화성단음계 딸림)\n")
    L.append("## 구간별 RMS·LUFS·스펙트럼 중심\n")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) | 8kHz 이상 에너지 (dB) |")
    L.append("|---|---|---|---|---|---|---|")
    for r in res["sections"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['peak']:.2f} | {r['lufs']:.2f} | "
                 f"{r['cent']:.0f} | {r['hf']:.1f} |")
    L.append(f"| 전체 | 0:00～5:00 | {res['total_rms']:.2f} | {res['peak']:.2f} | {res['lufs']:.2f} | {res['cent']:.0f} | "
             f"{res['hf']:.1f} |")
    L.append("")
    L.append("세부 구간\n")
    L.append("| 세부 구간 | 시간 | RMS (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) | 8kHz 이상 (dB) |")
    L.append("|---|---|---|---|---|---|")
    for r in res["sub"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['lufs']:.2f} | {r['cent']:.0f} | "
                 f"{r['hf']:.1f} |")
    L.append("")
    L.append("악기 갈래별 RMS (마스터 이득 적용, 리버브·딜레이 제외, dBFS)\n")
    L.append("| 갈래 | " + " | ".join(n for n, _ in SECTIONS) + " |")
    L.append("|---|" + "---|" * len(SECTIONS))
    for k, row in stem_rms.items():
        L.append(f"| {k} | " + " | ".join(("—" if v < -90 else f"{v:.1f}") for v in row) + " |")
    L.append("")
    L.append("## 15초 창 RMS 곡선\n")
    L.append("```")
    for t0, sec, r, cf in res["windows"]:
        L.append(f"{mmss(t0)} {sec} {r:7.2f}  크레스트 {cf:5.1f} dB  " + "■" * max(0, int(round(r + 40))))
    L.append("```")
    L.append("(■ 1칸 = 1 dB, 기준 −40 dBFS. 크레스트 = 창 안 피크 − RMS)\n")
    s = res["seam"]
    L.append("## 루프 이음매\n")
    L.append("| 항목 | 값 |")
    L.append("|---|---|")
    L.append(f"| 끝 50ms RMS / 처음 50ms RMS | {s['end50']:.2f} / {s['start50']:.2f} dBFS |")
    L.append(f"| 끝 1초 RMS / 처음 1초 RMS | {s['end1s']:.2f} / {s['start1s']:.2f} dBFS |")
    L.append(f"| 경계 샘플 차(끝→처음) | {s['jump']:.5f} (처음 1초 인접 샘플 차 최대 {s['typ']:.5f}) |")
    L.append(f"| 스펙트럼 중심 끝 10초 / 처음 10초 | {s['cent_end']:.0f} / {s['cent_start']:.0f} Hz |")
    L.append("| 방식 | 300초 원형 버퍼: 끝을 넘는 음 꼬리·리버브·딜레이·코러스가 앞머리로 감김. 마지막 화음 G6 → 첫 화음 Am7, "
             "양끝 모두 패드+아르페지오·같은 마스터 레벨(0.92)·같은 밝기(0.22), 코러스 LFO 120주기/300초 |")
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
    ap = argparse.ArgumentParser(description="'야간 주행' 작업 배경음악 합성")
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
        ("8kHz 이상 에너지", "≤ −25 dB(전체 대비)", f"{res['hf']:.1f} dB", res["hf"] <= -25.0),
        ("PCM 길이", "정확히 300초", f"{pcm.shape[1]} 샘플 = {pcm.shape[1]/SR:.3f}초", pcm.shape[1] == N),
    ]
    ok = all(c[3] for c in checks)
    elapsed = time.time() - t0
    files = [(os.path.basename(out), len(mp3), mp3_sha), (os.path.basename(jpath), os.path.getsize(jpath), sha(jpath)),
             ("spectrogram.png", os.path.getsize(png), sha(png)),
             ("compose_drive.py", os.path.getsize(os.path.abspath(__file__)), sha(os.path.abspath(__file__)))]
    write_report(os.path.join(od, "report.md"), res, stem_rms, {"checks": checks, "files": files, "pcm_sha": pcm_sha},
                 gr, elapsed)
    for c in checks:
        print(f"  {c[0]}: {c[2]} ({c[1]}) {'통과' if c[3] else '실패'}")
    print(f"  검사: {'통과' if ok else '실패'}  (실행 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
