#!/usr/bin/env python3
"""'작은 도시' 작업 배경음악 결정적 합성기.

이전 프로젝트 music.js 의 `city` 곡(시티빌더 배경, G major, 마림바·플럭·스트링, genCity)을
numpy 로 옮겨 5분(300초) 편곡으로 만든다. 외부 샘플 없이 전부 합성한다.
마스터링·원형 루프·검사 부분은 music/compose.py 를 복사해 재사용했다.

구조: 104 BPM, 4/4, 130마디 = 300초, G major (클라이맥스만 A major 로 온음 조바꿈 후 D7 로 복귀).
  기  0:00～0:37  (마디   0～15)  마림바 단독 오스티나토 → 낮은 마림바·8분 셰이커
  승  0:37～1:51  (마디  16～47)  플럭 주제 A·B, 둥근 베이스, 소프트 킥, 셰이커, 림 클릭
  전  1:51～4:00  (마디  48～103) 스트링 진입·대선율, 단조 그늘(C), 피치카토 브레이크, A장조 클라이맥스
  결  4:00～5:00  (마디 104～129) 킥·셰이커 빠짐, 마림바 선율로 주제 B 회상, 마림바 단독으로 정리 → 처음으로

주제 선율은 원곡과 같은 방식(mulberry32 + FNV-1a 씨앗, 2마디 동기 두 개의 물음·대답)으로 만들어
원곡과 같은 동기가 나온다. 루프: 모든 꼬리·리버브·딜레이는 300초 원형 버퍼로 앞머리에 감긴다.

사용법:
  python compose_city.py --out bgm-city.mp3 [--wav 미리듣기.wav]
  (같은 폴더에 bgm-city.json, report.md, spectrogram.png 도 만든다)
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
BPM = 104
BEAT = 60.0 / BPM            # 0.5769 s
ST = BEAT / 4                # 16분음표
BAR = 4 * BEAT               # 2.3077 s
BARS = 130
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))     # 13,230,000 samples
TARGET_LUFS = -16.0
CEIL_DB = -1.5               # 샘플 피크 상한 (MP3 오버슈트 여유 포함, 계약 -1 dBFS 이하)
BITRATE = 128
SECTIONS = [("기", 0), ("승", 16), ("전", 48), ("결", 104)]
TITLE = "작은 도시"
MOOD = "밝고 잔잔한 집중용 — 마림바 오스티나토, 플럭, 스트링, 가벼운 셰이커·림·소프트 킥"

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "bgm-city.mp3")

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


# ───────────────────────── 씨앗 난수 (music.js mulberry32 · FNV-1a 그대로) ─────────────────────────

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
    for u in s.encode("utf-16-le").decode("utf-16-le"):
        for cu in ([ord(u)] if ord(u) < 0x10000 else [0xD800 + ((ord(u) - 0x10000) >> 10), 0xDC00 + ((ord(u) - 0x10000) & 0x3FF)]):
            h ^= cu
            h = _imul(h, 16777619)
    return h & M32


def rng_of(*k):
    return mulberry(hash_str("|".join(str(x) for x in k)))


def pick(r, a):
    return a[int(r() * len(a))]


# ───────────────────────── 화음 · 음계 (music.js 이식) ─────────────────────────

def mod12(n):
    return n % 12


NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
        "m9": [0, 3, 7, 10, 14], "maj9": [0, 4, 7, 11, 14], "9": [0, 4, 7, 10, 14], "6": [0, 4, 7, 9],
        "m6": [0, 3, 7, 9], "m7b5": [0, 3, 6, 10], "sus2": [0, 2, 7], "sus4": [0, 5, 7], "add9": [0, 4, 7, 14]}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11]}
KEY = 67   # G


def pc_of(s):
    acc = 1 if len(s) > 1 and s[1] == "#" else -1 if len(s) > 1 and s[1] == "b" else 0
    return mod12(NOTE_PC[s[0]] + acc)


_CC = {}


def chord_p(name, tr=0):
    k = (name, tr)
    if k in _CC:
        return _CC[k]
    main, _, slash = name.partition("/")
    acc = 2 if len(main) > 1 and main[1] in "#b" else 1
    iv = QUAL[main[acc:]]
    r = mod12(pc_of(main) + tr)
    ch = {"name": name, "r": r, "iv": iv, "pcs": [mod12(r + x) for x in iv],
          "bass": mod12(pc_of(slash) + tr) if slash else r}
    _CC[k] = ch
    return ch


def chord_scale(key_pc, scale, ch):
    s = [mod12(key_pc + x) for x in scale]
    for pc in ch["pcs"]:
        if pc not in s:
            idx = next((i for i, x in enumerate(s) if mod12(x - pc) == 1 or mod12(pc - x) == 1), -1)
            if idx >= 0:
                s[idx] = pc
            else:
                s.append(pc)
    return s


def nearest_pc(m, pcs):
    for d in range(7):
        if mod12(m - d) in pcs:
            return m - d
        if mod12(m + d) in pcs:
            return m + d
    return m


def step_in(m, n, pcs):
    x = m
    if mod12(x) not in pcs:
        x = nearest_pc(x, pcs)
    d = (n > 0) - (n < 0)
    for _ in range(abs(n)):
        x += d
        g = 0
        while mod12(x) not in pcs and g < 12:
            x += d
            g += 1
    return x


def bass_note(pc, lo):
    return lo + mod12(pc - lo)


def voicing(ch, center, n, rootless):
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

RH = ["x-x-x---x-x-x---|x---x---x-------", "x---x-x-x---x---|x-x-x-x-x-------",
      "x-x---x-x-x---x-|x-------x---....", "..x-x-x-x---x-x-|x---x---x-------"]
PROGS = {
    "A": "G Em C D",
    "B": "C D Bm Em Am D G G",
    "C": "Em C G D Am Em B7 Em",
    "BRK": "C D Bm Em C D Am7 D",
    # 클라이맥스: A장조(온음 위)로 올라갔다가 D(=G의 V)·Am7·D7 로 G 에 돌아온다
    "CL": "A F#m D E A F#m D E A F#m Bm E D Bm Am7 D7",
    "OA": "G Em C D Bm Em Am7 D",
    "OB": "C D G Em C D G G G Em C D",
    "OC": "G Em C D Am7 D",
}
PROGS = {k: v.split() for k, v in PROGS.items()}

# on: 켜는 갈래 · th 주제 · li 주제 악기 · oct 주제 옥타브 · kt 음계 조옮김(반음)
SECS = [
    dict(n="인트로", bars=8, p="A", on="mar"),
    dict(n="인트로 2", bars=8, p="A", on="mar mlow shk8"),
    dict(n="A", bars=16, p="A", on="mar bass shaker kick lead", th="A", li="pluck"),
    dict(n="B", bars=16, p="B", on="mar bass shaker kick rim lead glk", th="B", li="pluck"),
    dict(n="A2 · 스트링", bars=16, p="A", on="mar bass shaker kick rim strings lead counter", th="A", li="glock", oct=-12),
    dict(n="C · 그늘", bars=16, p="C", on="mar bass kick half rim strings lead", th="C", li="marLead"),
    dict(n="브레이크", bars=8, p="BRK", on="pizz shk8 strings roll"),
    dict(n="D · 클라이맥스", bars=16, p="CL", kt=2, on="mar bass shaker kick rim strings lead dbl glk counter", th="A", li="pluck"),
    dict(n="결 A", bars=8, p="OA", on="mar bass shaker kick kfade strings lead", th="B", li="marLead"),
    dict(n="결 B", bars=12, p="OB", on="mar mlow bass2 strings lead8", th="B", li="marLead"),
    dict(n="결 끝", bars=6, p="OC", on="mar"),
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


def bar_chords(sec, bl):
    lst = PROGS[sec["p"]]
    names = lst[bl % len(lst)].split("-")
    return [{"s": i * 16 / len(names), "len": 16 / len(names), "ch": chord_p(nm)} for i, nm in enumerate(names)]


def half_at(halves, s):
    h = halves[0]
    for x in halves:
        if x["s"] <= s:
            h = x
    return h


# ── 선율 동기(2마디 · 16분 32걸음), music.js parseRh·makeMotif·realize 이식 ──

def parse_rh(s):
    s = s.replace("|", "")
    out = []
    for i, c in enumerate(s):
        if c == "x":
            l = 1
            while i + l < len(s) and s[i + l] == "-":
                l += 1
            out.append((i, l))
    return out


def make_motif(r, rhythms):
    rh = parse_rh(pick(r, rhythms))
    return [{"s": s, "l": l, "mv": 0 if i == 0 else pick(r, [1, 1, 2, -1, 3, 0, 1] if i < len(rh) / 2 else [-1, -1, -2, 1, -3, 0, -1])}
            for i, (s, l) in enumerate(rh)]


_TH = {}


def theme(th):
    if th not in _TH:
        _TH[th] = {"m1": make_motif(rng_of("city", th, 1), RH), "m2": make_motif(rng_of("city", th, 2), RH)}
    return _TH[th]


def realize(sec, th, chunk, o):
    T = theme(th)
    k = chunk % 4
    mot = T["m1"] if k in (0, 2) else T["m2"]
    b0 = bar_chords(sec, chunk * 2)
    b1 = bar_chords(sec, chunk * 2 + 1) if chunk * 2 + 1 < sec["bars"] else b0
    ch_at = lambda s: (half_at(b0, s) if s < 16 else half_at(b1, s - 16))["ch"]
    key_pc = mod12(KEY + sec.get("kt", 0))
    vr = rng_of("city", th, "v", k)
    cur = nearest_pc(o["center"] + (2 if k == 2 else 0), ch_at(0)["pcs"])
    out = []
    for i, nt in enumerate(mot):
        ch = ch_at(nt["s"])
        pcs = chord_scale(key_pc, SCALES["major"], ch)
        mv = nt["mv"]
        if k == 2 and i >= len(mot) - 3:
            mv = pick(vr, [-1, 1, 2, -2])
        if i > 0:
            cur = step_in(cur, mv, pcs)
        if nt["s"] % 8 == 0 or nt["l"] >= 6:
            cur = nearest_pc(cur, ch["pcs"])
        while cur > o["hi"]:
            cur -= 12
        while cur < o["lo"]:
            cur += 12
        out.append({"s": nt["s"], "l": min(nt["l"], 32 - nt["s"]), "m": cur})
    if k == 3 and out:      # 맺음 — 마지막 음을 근음·3도로 길게
        last = out[-1]
        ch = ch_at(last["s"])
        last["m"] = nearest_pc(last["m"], [ch["r"], ch["pcs"][1]])
        last["l"] = max(last["l"], min(12, 32 - last["s"]))
    for nt in out:
        nt["m"] += o.get("oct", 0)
    return out


def theme_notes(sec, bl, th, o):
    notes = realize(sec, th, bl >> 1, o)
    off = (bl & 1) * 16
    return [{"s": n["s"] - off, "l": n["l"], "m": n["m"]} for n in notes if off <= n["s"] < off + 16]


# ───────────────────────── 생성기 (genCity 이식 · 작업용으로 누그러뜨림) ─────────────────────────

# 마림바 오스티나토: 음 높이 순서(MP)와 싱코페이션 리듬(3+3+2 계열, 16분 자리·세기)
MP = [[0, 2, 1, 2, 3, 2, 1, 2], [0, 1, 2, 3, 2, 1, 2, 1], [3, 2, 1, 2, 0, 2, 1, 2], [0, 2, 3, 2, 1, 2, 3, 1]]
MRH = [
    [(0, 1.0), (3, 0.78), (6, 0.88), (8, 0.7), (10, 0.62), (11, 0.8), (14, 0.82)],
    [(0, 1.0), (2, 0.6), (3, 0.82), (6, 0.88), (8, 0.7), (11, 0.82), (14, 0.78)],
    [(0, 1.0), (3, 0.8), (6, 0.9), (8, 0.62), (10, 0.72), (12, 0.6), (14, 0.8)],
    [(0, 1.0), (2, 0.62), (4, 0.7), (6, 0.85), (7, 0.6), (10, 0.82), (12, 0.66), (14, 0.78)],
]
INTRO_RH = [(0, 1.0), (3, 0.8), (6, 0.88), (8, 0.7), (11, 0.8), (14, 0.82)]


def gen_bar(bi, state):
    si, bl = MAP[bi]
    sec = SECS[si]
    on = sec["on"]
    halves = bar_chords(sec, bl)
    r = rng_of("city", "bar", bi)
    ev = []
    last = bl == sec["bars"] - 1

    def E(s, ins, m, l, v, pan=0.0):
        ev.append({"s": s, "ins": ins, "m": m, "l": l, "v": v, "pan": pan})

    if "mar" in on:
        rh = INTRO_RH if (sec["n"] == "인트로" and bl < 4) else MRH[(sec["i"] + (bl >> 2)) % len(MRH)]
        pat = MP[(sec["i"] + (bl >> 2)) % len(MP)]
        k = 0
        for h in halves:
            ch = h["ch"]
            root = nearest_pc(60, [ch["r"]])
            tones = [root, root + ch["iv"][1], root + ch["iv"][2], root + 12]
            for s, acc in rh:
                if h["s"] <= s < h["s"] + h["len"]:
                    E(s, "marimba", tones[pat[k % 8]], 3, 0.1 * acc, -0.28 + 0.16 * (k % 2))
                    k += 1
    if "mlow" in on:
        for h in halves:
            root = bass_note(h["ch"]["bass"], 43)
            for s, k_, v in [(0, 0, 0.09), (6, 7, 0.06), (10, 0, 0.065)]:
                if s < h["len"]:
                    E(h["s"] + s, "marimba", root + k_, 4, v, 0.15)
    if "bass" in on or "bass2" in on:
        for h in halves:
            root = bass_note(h["ch"]["bass"], 40)
            pat = ([(0, 0, 3), (6, 7, 2), (8, 0, 3), (12, 12, 2), (14, 7, 2)] if "half" not in on and "bass2" not in on
                   else [(0, 0, 6), (10, 7, 2), (14, 0, 2)])
            for s, k_, l in pat:
                if s < h["len"]:
                    E(h["s"] + s, "bass", root + k_, l, (0.22 if s == 0 else 0.15) * (0.8 if "bass2" in on else 1.0))
    if "shaker" in on:
        for s in range(16):
            E(s, "shaker", 0, 1, [0.05, 0.02, 0.032, 0.022][s % 4], 0.35)
    if "shk8" in on:
        for s in range(0, 16, 2):
            E(s, "shaker", 0, 1, (0.036 if s % 4 == 0 else 0.026) * (0.6 if sec["n"] == "인트로 2" and bl < 4 else 1.0), 0.35)
    fill = "kick" in on and last and "kfade" not in on
    if "kick" in on:
        kv = 1.0 - 0.09 * bl if "kfade" in on else 1.0
        E(0, "kick", 0, 1, 0.26 * kv)
        if "half" not in on:
            E(8, "kick", 0, 1, 0.2 * kv)
            if r() < 0.35:
                E(11, "kick", 0, 1, 0.11 * kv)
        elif r() < 0.5:
            E(10, "kick", 0, 1, 0.15)
    if "rim" in on:
        E(4, "rim", 0, 1, 0.07, -0.15)
        if not fill:
            E(12, "rim", 0, 1, 0.07, -0.15)
        if r() < 0.3:
            E(pick(r, [7, 15]), "rim", 0, 1, 0.03, -0.15)
    if fill:
        for s, m in [(12, 52), (13, 50), (14, 47), (15, 45)]:
            E(s, "tom", m, 1, 0.1, 0.3 - 0.2 * (s - 12))
    if "strings" in on:
        for h in halves:
            vs = voicing(h["ch"], 62, 3, False)
            for j, m in enumerate(vs):
                E(h["s"], "strings", m, h["len"], 0.026, -0.45 + 0.45 * j)
    if "lead" in on or ("lead8" in on and bl < 8):
        li = sec.get("li", "pluck")
        o = {"lo": 72, "hi": 88, "center": 79, "oct": sec.get("oct", 0)}
        vel = {"glock": 0.06, "marLead": 0.1, "pluck": 0.07}[li] * (0.75 if "lead8" in on else 1.0)
        for nt in theme_notes(sec, bl, sec["th"], o):
            E(nt["s"], li, nt["m"], nt["l"], vel, 0.12)
            if "dbl" in on:
                E(nt["s"], "marLead", nt["m"] - 12, nt["l"], 0.05, -0.1)
    if "glk" in on:
        for s in (0, 8):
            if r() < 0.55:
                h = half_at(halves, s)
                E(s + pick(r, [0, 2, 3]), "glock", nearest_pc(74 + int(r() * 5), h["ch"]["pcs"]), 6, 0.028, 0.45)
    if "counter" in on:
        state.setdefault("cnt", 67)
        for h in halves:
            state["cnt"] = max(62, min(72, nearest_pc(state["cnt"] + pick(r, [-2, -1, 1, 2]), h["ch"]["pcs"])))
            E(h["s"], "strings", state["cnt"] + 12, h["len"], 0.022, 0.3)
    if "pizz" in on:
        for h in halves:
            tones = voicing(h["ch"], 62, 4, False)
            seq = tones + tones[1:-1][::-1]
            for s in range(int(h["s"]), int(h["s"] + h["len"]), 2):
                E(s, "pizz", seq[((s - int(h["s"])) // 2) % len(seq)] + (12 if bl % 2 else 0), 2, 0.08,
                  -0.35 + 0.7 * (((s // 2) % 2)))
    if "roll" in on and bl == sec["bars"] - 2:
        for s, m in [(0, 52), (4, 50), (8, 47), (12, 45)]:
            E(s, "tom", m, 2, 0.09)
    if "roll" in on and bl == sec["bars"] - 1:
        for s in range(16):
            E(s, "shaker", 0, 1, 0.014 + s * 0.0022, 0.0)
    # 시각: 마디 머리 + 16분 자리 + 사람 손 흔들림(±4ms)
    for e in ev:
        e["t"] = tb(bi) + e["s"] * ST + (r() - 0.5) * 0.008
        e["d"] = e["l"] * ST
        e["bar"] = bi
    return ev


def build_events():
    state = {}
    ev = []
    for bi in range(BARS):
        ev.extend(gen_bar(bi, state))
    return ev


# ───────────────────────── 악기 (music.js INS 를 numpy 로, 고음·트랜지언트 누그러뜨림) ─────────────────────────

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


def ins_marimba(f, dur, v):
    # 원곡 [1,1,0.24],[4,0.22,0.035] + 둥근 몸통(배음 2 아주 약하게), 말렛 어택 6ms 로 부드럽게
    return partials(f, dur, v, [(1, 1, 0.30), (4, 0.16, 0.03), (2, 0.04, 0.08)], att=0.006, gate_tau=0.12)


def ins_marlead(f, dur, v):
    return partials(f, dur, v, [(1, 1, 0.36), (4, 0.14, 0.035), (2, 0.05, 0.1)], att=0.006, gate_tau=0.12)


def ins_glock(f, dur, v):
    return partials(f, dur, v, [(1, 1, 0.55), (2.76, 0.22, 0.14), (5.4, 0.04, 0.05)], att=0.005, gate_tau=0.2)


def ins_pizz(f, dur, v):
    return partials(f, dur, v, [(1, 1, 0.14), (2, 0.2, 0.05)], wave="triangle", att=0.005)


def ins_pluck(f, dur, v):
    # 사각파 → 빨리 닫히는 저역 통과(f*7 → f*1.4, τ 0.07) 를 홀수 배음 가산 합성으로 근사(상한 5kHz)
    end = dur
    rel = 0.09
    n = int((end + rel * 5) * SR)
    t = _t(n)
    fc = f * 1.4 + (min(5000.0, f * 7) - f * 1.4) * np.exp(-t / 0.07)
    y = np.zeros(n)
    for h in range(1, 40, 2):
        fh = f * h
        if fh > 7000:
            break
        y += (4 / np.pi) / h * np.sin(2 * np.pi * fh * t) / np.sqrt(1 + (fh / fc) ** 4)
    env = env_target(t, 0.005, v, 0.22, 0.18, end, rel)
    return _fade_tail(y * env * 0.7).astype(F32)


def ins_strings(f, dur, v, ph=(0.0, 0.0)):
    rel = 0.55
    n = int((dur + rel * 5) * SR)
    t = _t(n)
    env = env_target(t, min(0.45, dur * 0.3), v, 1.5, 0.85, dur, rel)
    out = np.zeros((2, n))
    for ch, cents in enumerate(((-7.0, 4.0), (-3.0, 8.0))):
        s = np.zeros(n)
        for c in cents:
            s += polyblep_saw(f * 2 ** (c / 1200), n, rng.random())
        out[ch] = s * env * 0.5
    return _fade_tail_st(out).astype(F32)


def _fade_tail_st(y, ms=6):
    k = min(y.shape[1], int(ms * SR / 1000))
    y[:, -k:] *= np.linspace(1, 0, k)[None, :]
    return y


def ins_bass(f, dur, v):
    # 둥근 베이스: 사인 + 약한 2·3배음, 어택 10ms, 게이트 뒤 80ms 릴리스
    rel = 0.08
    n = int((dur + 0.5) * SR)
    t = _t(n)
    y = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(4 * np.pi * f * t) + 0.06 * np.sin(6 * np.pi * f * t)
    y = np.tanh(1.2 * y) / np.tanh(1.2)
    env = env_target(t, 0.01, v, 0.45, 0.55, dur, rel)
    return _fade_tail(y * env).astype(F32)


def ins_kick(v):
    # 소프트 킥(원곡 lkick): 105 → 42 Hz, 감쇠 τ 0.12, 클릭 없이 3ms 어택
    n = int(0.65 * SR)
    t = _t(n)
    f = 42 * (105 / 42) ** np.exp(-t / 0.05)
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


def ins_noise(v, dur, att):
    """music.js nz(): 선형 어택 → τ=dur/3 감쇠. 대역은 버스에서 한꺼번에 거른다."""
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
            sig = fn(e)
            add(bus, e["t"], sig, e["pan"])
    return bus


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

    # 킥 + 사이드체인 트리거
    kbus = new_bus()
    trig = np.zeros(N, dtype=F32)
    for e in events:
        if e["ins"] == "kick":
            add(kbus, e["t"], ins_kick(e["v"]))
            trig[int(round(e["t"] * SR)) % N] += e["v"]
        elif e["ins"] == "tom":
            add(kbus, e["t"], ins_tom(mtof(e["m"]), e["v"]), e["pan"])
    duck = sidechain(trig)
    kbus = fd_filter(kbus, hp_mag(f, 32, 2) * lp_mag(f, 2500, 2))
    kbus *= 0.85
    stems["kick·tom"] = kbus
    mix += kbus
    rev_send += 0.04 * kbus
    del kbus
    st("kick")

    sh = render_bus(events, {"shaker"}, lambda e: ins_noise(e["v"], 0.055, 0.010))
    sh = fd_filter(sh, hp_mag(f, 3200, 2) * lp_mag(f, 7500, 3))
    sh *= 2.6
    stems["shaker"] = sh
    mix += sh
    rev_send += 0.25 * sh
    del sh
    rm = render_bus(events, {"rim"}, lambda e: ins_noise(e["v"], 0.03, 0.0015))
    # 림 클릭: 1.7kHz 근처 좁은 대역(원곡 Q4) — 4차 HP·LP 로 둥글게
    rm = fd_filter(rm, hp_mag(f, 1350, 2) * lp_mag(f, 2300, 2))
    rm *= 7.0
    stems["rim"] = rm
    mix += rm
    rev_send += 0.45 * rm
    del rm
    st("shaker·rim")

    # 밝기 자동화: 인트로·결은 어둡게, 클라이맥스에서 가장 밝게 (처음·끝 값 같음 → 루프 연속)
    bright = automation([(0, 0.3), (16, 0.55), (48, 0.8), (64, 0.6), (80, 0.45), (88, 1.0), (104, 0.7),
                         (118, 0.4), (130, 0.3)])

    mr = render_bus(events, {"marimba"}, lambda e: cached("marimba", e["m"], e["d"], ins_marimba) * F32(e["v"]))
    hp = hp_mag(f, 90, 1)
    mr = fd_split(mr, hp * lp_mag(f, 2400, 2), hp * lp_mag(f, 7000, 1), bright)
    mr *= 1.25
    stems["marimba"] = mr
    mix += mr
    rev_send += 0.35 * mr
    echo_send += 0.08 * mr
    del mr
    st("marimba")

    LFN = {"pluck": (ins_pluck, 1.8), "marLead": (ins_marlead, 1.62), "glock": (ins_glock, 1.62)}
    lead = render_bus(events, set(LFN), lambda e: cached(e["ins"], e["m"], e["d"], LFN[e["ins"]][0])
                      * F32(e["v"] * LFN[e["ins"]][1]))
    hp = hp_mag(f, 150, 1)
    lead = fd_split(lead, hp * lp_mag(f, 2800, 2), hp * lp_mag(f, 6000, 1), bright)
    stems["lead"] = lead
    mix += lead
    rev_send += 0.45 * lead
    echo_send += 0.3 * lead
    del lead
    st("lead")

    pz = render_bus(events, {"pizz"}, lambda e: cached("pizz", e["m"], e["d"], ins_pizz) * F32(e["v"]))
    pz = fd_filter(pz, lp_mag(f, 4000, 2) * hp_mag(f, 120, 1)) * 3.2
    stems["pizz"] = pz
    mix += pz
    rev_send += 0.4 * pz
    echo_send += 0.15 * pz
    del pz

    sbus = new_bus()
    for e in events:
        if e["ins"] == "strings":
            sig = cached("strings", e["m"], e["d"], ins_strings) * F32(e["v"])
            gl_, gr_ = pan_gains(e["pan"])
            sig[0] *= gl_ * 1.41
            sig[1] *= gr_ * 1.41
            add(sbus, e["t"], sig)
    sbus = fd_filter(sbus, lp_mag(f, 2200, 2) * hp_mag(f, 140, 1))
    sbus *= automation([(0, 1), (112, 1), (122, 0.0), (130, 0.0)])[None, :]
    sbus *= (0.55 + 0.45 * duck)[None, :]
    sbus *= 1.2
    stems["strings"] = sbus
    mix += sbus
    rev_send += 0.55 * sbus
    del sbus
    st("strings·pizz")

    bs = render_bus(events, {"bass"}, lambda e: cached("bass", e["m"], e["d"], ins_bass) * F32(e["v"]))
    bs = fd_filter(bs, lp_mag(f, 700, 2) * hp_mag(f, 35, 2))
    bs *= (0.7 + 0.3 * duck)[None, :]
    bs *= 0.5
    stems["bass"] = bs
    mix += bs
    rev_send += 0.05 * bs
    del bs
    st("bass")

    echo = circ_conv(echo_send.mean(axis=0), echo_ir())
    mix += 0.45 * echo
    rev_send += 0.4 * echo
    del echo, echo_send
    st("echo")
    wet = circ_conv(rev_send, reverb_ir())
    wet = fd_filter(wet, hp_mag(f, 150, 1) * lp_mag(f, 7000, 1))
    mix += 0.3 * wet
    del wet, rev_send
    st("reverb")

    # 마스터: 처음과 끝을 같은 수준으로(마림바 단독 ↔ 마림바 단독) 루프 이음매 연속
    mix *= automation([(0, 0.9), (2, 1.0), (127, 1.0), (130, 0.9)])[None, :]
    # 초저역 정리 + 11kHz 위를 완만히 눌러 날카로움 방지
    mix = fd_filter(mix, hp_mag(f, 28, 2) * lp_mag(f, 11000, 1))

    lufs0 = loudness(mix)
    gain = F32(10 ** ((TARGET_LUFS - lufs0) / 20))
    mix *= gain
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
    for _ in range(2):
        l1 = loudness(mix)
        if abs(l1 - TARGET_LUFS) < 0.3:
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
    bounds = [s for _, s in SECTIONS] + [BARS]
    for name, x in stems.items():
        row = []
        for k in range(len(SECTIONS)):
            seg = x[:, int(tb(bounds[k]) * SR):int(tb(bounds[k + 1]) * SR)].astype(np.float64) * float(gain)
            row.append(20 * math.log10(max(math.sqrt(float((seg ** 2).mean())), 1e-9)))
        stem_rms[name] = row
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


def analyze(x, log=print):
    res = {"sections": [], "sub": [], "windows": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    log("\n구간별 에너지")
    log("  구간  시간          RMS(dBFS)  피크(dBFS)  LUFS(근사)  중심(Hz)")
    for k, (name, b0) in enumerate(SECTIONS):
        t0, t1 = tb(b0), tb(bounds[k + 1])
        seg = x[:, int(t0 * SR):int(t1 * SR)].astype(np.float64)
        row = dict(name=name, t0=t0, t1=t1, bars=(b0, bounds[k + 1] - 1),
                   rms=db(math.sqrt(float((seg ** 2).mean()))), peak=db(float(np.abs(seg).max())),
                   lufs=loudness(seg), cent=centroid(seg))
        res["sections"].append(row)
        log(f"  {name}    {mmss(t0)}～{mmss(t1)}    {row['rms']:7.2f}   {row['peak']:8.2f}   {row['lufs']:8.2f}   {row['cent']:7.0f}")
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
    log(f"  전체  0:00～5:00    {res['total_rms']:7.2f}   {res['peak']:8.2f}   {res['lufs']:8.2f}   {res['cent']:7.0f}"
        f"   (트루피크 근사 {res['true_peak']:.2f} dBTP)")
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
                       jump=jump, typ=typ, cent_end=centroid(x[:, -10 * SR:]), cent_start=centroid(x[:, :10 * SR]))
    s = res["seam"]
    log(f"\n루프 이음매: 끝 50ms RMS {s['end50']:.2f} dBFS, 처음 50ms RMS {s['start50']:.2f} dBFS, "
        f"경계 샘플 차 {jump:.5f} (전형적 인접 샘플 차 최대 {typ:.5f})")
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
    L.append(f"- 생성: `compose_city.py` (seed {SEED}, numpy {np.__version__}), 실행 시간 {elapsed:.0f}초")
    L.append(f"- 형식: {SR} Hz 스테레오, {BITRATE} kbps CBR MP3, {BPM} BPM 4/4, {BARS}마디 = {DUR:.1f}초, G major")
    L.append(f"- 원곡: 이전 프로젝트 `music.js` `city`(112 BPM) — 화음 진행 A·B·C·D, 주제 동기(씨앗 'city|A|1' 등), "
             f"마림바 MP 오스티나토, 베이스 음형을 이식. 템포 104 BPM, 고음 악기는 한 옥타브 내리거나 저역 통과\n")
    L.append("## 곡 구조\n")
    L.append("| 큰 구간 | 세부 구간 | 시간 | 마디 | 화음 진행 | 편성 |")
    L.append("|---|---|---|---|---|---|")
    big = {0: "기", 1: "기", 2: "승", 3: "승", 4: "전", 5: "전", 6: "전", 7: "전", 8: "결", 9: "결", 10: "결"}
    desc = {
        "인트로": "마림바 단독 싱코페이션 오스티나토(3+3+2), 어두운 필터",
        "인트로 2": "낮은 마림바 근음, 8분 셰이커(약하게)",
        "A": "플럭 주제 A, 둥근 베이스, 소프트 킥(1·3박+가끔 당김), 16분 셰이커",
        "B": "플럭 주제 B, 림 클릭 2·4박, 글로켄(한 옥타브 내림) 점묘",
        "A2 · 스트링": "스트링 화음·대선율 진입, 주제 A 를 글로켄으로 한 옥타브 아래",
        "C · 그늘": "단조 그늘(Em), 반박자 킥, 마림바 리드로 주제 C",
        "브레이크": "피치카토 아르페지오, 8분 셰이커, 스트링, 끝에 부드러운 탐·셰이커 상승",
        "D · 클라이맥스": "A장조(온음 위)로 주제 A, 플럭+마림바 옥타브 겹침, 대선율, 필터 최대 → Am7·D7 로 G 복귀",
        "결 A": "주제 B 를 마림바 리드로, 킥 점점 약하게",
        "결 B": "킥·셰이커 빠짐, 베이스 성기게, 스트링 사라짐, 주제 B 앞 8마디만",
        "결 끝": "마림바 단독으로 정리 → D 에서 처음의 G 로 이어짐(루프)",
    }
    for i, s in enumerate(SECS):
        b0 = SEC_START[s["n"]]
        prog = " ".join(PROGS[s["p"]][:min(len(PROGS[s["p"]]), s["bars"])])
        L.append(f"| {big[i]} | {s['n']} | {mmss(tb(b0))}～{mmss(tb(b0 + s['bars']))} | {b0}～{b0 + s['bars'] - 1} | {prog} | {desc[s['n']]} |")
    L.append("")
    L.append("## 구간별 RMS·LUFS·스펙트럼 중심\n")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) | 스펙트럼 중심 (Hz) |")
    L.append("|---|---|---|---|---|---|")
    for r in res["sections"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['peak']:.2f} | {r['lufs']:.2f} | {r['cent']:.0f} |")
    L.append(f"| 전체 | 0:00～5:00 | {res['total_rms']:.2f} | {res['peak']:.2f} | {res['lufs']:.2f} | {res['cent']:.0f} |")
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
    L.append(f"| 경계 샘플 차(끝→처음) | {s['jump']:.5f} (처음 1초 인접 샘플 차 최대 {s['typ']:.5f}) |")
    L.append(f"| 스펙트럼 중심 끝 10초 / 처음 10초 | {s['cent_end']:.0f} / {s['cent_start']:.0f} Hz |")
    L.append("| 방식 | 300초 원형 버퍼: 끝을 넘는 음 꼬리·리버브·딜레이가 앞머리로 감김. 마지막 화음 D → 첫 화음 G(딸림→으뜸), 양끝 모두 마림바 단독·같은 마스터 레벨(0.9)·같은 밝기(0.3) |")
    L.append("| 한계 | MP3 인코더 지연·패딩(약 25～50ms)은 남으므로 `<audio loop>` 는 완전 무간격이 아님 |")
    L.append("")
    L.append("## 검사\n")
    L.append("| 항목 | 기준 | 결과 | 판정 |")
    L.append("|---|---|---|---|")
    chk = mp3_info["checks"]
    for name, crit, val, ok in chk:
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
    ap = argparse.ArgumentParser(description="'작은 도시' 작업 배경음악 합성")
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
    meta = {"duration": int(round(DUR)), "bpm": BPM, "key": "G major",
            "sections": [{"name": n, "start": int(round(tb(b)))} for n, b in SECTIONS], "seed": SEED,
            "title": TITLE, "mood": MOOD}
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
        ("샘플 피크", "≤ −1 dBFS", f"{res['peak']:.2f} dBFS", res["peak"] <= -1.0),
        ("트루 피크(4× 근사)", "참고", f"{res['true_peak']:.2f} dBTP", True),
        ("통합 라우드니스", "−16±1 LUFS", f"{res['lufs']:.2f} LUFS", abs(res["lufs"] - TARGET_LUFS) <= 1.0),
        ("PCM 길이", "정확히 300초", f"{pcm.shape[1]} 샘플 = {pcm.shape[1]/SR:.3f}초", pcm.shape[1] == N),
    ]
    ok = all(c[3] for c in checks)
    elapsed = time.time() - t0
    files = [(os.path.basename(out), len(mp3), mp3_sha), (os.path.basename(jpath), os.path.getsize(jpath), sha(jpath)),
             ("spectrogram.png", os.path.getsize(png), sha(png)),
             ("compose_city.py", os.path.getsize(os.path.abspath(__file__)), sha(os.path.abspath(__file__)))]
    write_report(os.path.join(od, "report.md"), res, stem_rms, {"checks": checks, "files": files, "pcm_sha": pcm_sha},
                 gr, elapsed)
    for c in checks:
        print(f"  {c[0]}: {c[2]} ({c[1]}) {'통과' if c[3] else '실패'}")
    print(f"  검사: {'통과' if ok else '실패'}  (실행 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
