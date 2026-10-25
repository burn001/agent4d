#!/usr/bin/env python3
"""작업 배경음악 '모퉁이 카페' 5분 편곡 — numpy 결정적 합성.

원곡 데이터: 작성자의 이전 프로젝트 music.js 의 cafe 곡(96 BPM, 셋잇단 스윙, Bb major, genCafe).
화음 진행(I·A·A2·B·X·O)·주제 동기(makeMotif/realize, mulberry32 씨앗)·워킹 베이스·솔로 규칙을 그대로 옮기고
120마디(=300초) 기승전결 편곡으로 늘렸다. 마스터링·루프·검사는 music/compose.py 에서 복사.

  기  0:00～0:50 (마디   0～19) EP 루바토 인트로 → 인트로(투필 베이스·브러시 스윕) → 헤드 A
  승  0:50～2:10 (마디  20～51) 워킹 베이스·브러시 탭·2·4 칙 진입, 헤드 A2·B·A2, 솔로 A(라이드 레가토)
  전  2:10～3:30 (마디  52～83) 솔로 A2·B·A2(클라이맥스), 베이스 브레이크
  결  3:30～5:00 (마디  84～119) 헤드 회상(비브라폰 옥타브)·A2, 아웃트로, EP 루바토 코다 → 처음으로 이어짐

사용법: python compose_jazz.py --out bgm-jazz.mp3 [--wav 미리듣기.wav] [--no-report]
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
STEP = BEAT / 4              # 16분 0.15625 s
BAR = 4 * BEAT               # 2.5 s
BARS = 120
DUR = BARS * BAR             # 300 s
N = int(round(DUR * SR))
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
TITLE = "모퉁이 카페 (5분 편곡)"
MOOD = "재즈풍 작업 배경음악 — 일렉트릭 피아노·브러시·워킹 베이스, 셋잇단 스윙, 차분함"
SECTIONS = [("기", 0), ("승", 20), ("전", 52), ("결", 84)]

rng = np.random.default_rng(SEED)
F32 = np.float32
M32 = 0xFFFFFFFF


# ───────────────────────── 기본 유틸(compose.py 에서 복사) ─────────────────────────

def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def loopf(f: float) -> float:
    return max(1, round(f * DUR)) / DUR


def tb(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


def pan_gains(pan: float):
    a = (pan + 1.0) * math.pi / 4.0
    return math.cos(a), math.sin(a)


def new_bus():
    return np.zeros((2, N), dtype=F32)


def add(buf, t0: float, sig, pan: float = 0.0):
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


def add_mono(buf, t0: float, sig):
    n = len(sig)
    i0 = int(round(t0 * SR)) % N
    end = i0 + n
    if end <= N:
        buf[i0:end] += sig
    else:
        k = N - i0
        buf[i0:] += sig[:k]
        buf[: n - k] += sig[k:]


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


# ───────────────────────── music.js 이식: 씨앗·화음·음계 ─────────────────────────

def imul(a, b):
    return (a * b) & M32


def mulberry(a):
    st = [a & M32]

    def r():
        a_ = (st[0] + 0x6D2B79F5) & M32
        st[0] = a_
        t = imul(a_ ^ (a_ >> 15), 1 | a_)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296.0
    return r


def hash_str(s):
    h = 2166136261
    for c in s:
        h ^= ord(c)
        h = imul(h, 16777619)
    return h


def rng_of(*k):
    return mulberry(hash_str("|".join(str(x) for x in k)))


def pick(r, a):
    return a[int(r() * len(a))]


def mod12(x):
    return x % 12


NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
        "m9": [0, 3, 7, 10, 14], "maj9": [0, 4, 7, 11, 14], "9": [0, 4, 7, 10, 14], "6": [0, 4, 7, 9],
        "m6": [0, 3, 7, 9], "m7b5": [0, 3, 6, 10]}
SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11]
KEY = 70  # Bb


class Chord:
    __slots__ = ("name", "q", "r", "iv", "pcs")

    def __init__(self, name):
        acc = 2 if len(name) > 1 and name[1] in "#b" else 1
        q = name[acc:]
        r = NOTE_PC[name[0]] + (1 if name[1:2] == "#" else -1 if name[1:2] == "b" else 0)
        self.name, self.q, self.r, self.iv = name, q, mod12(r), QUAL[q]
        self.pcs = [mod12(self.r + x) for x in self.iv]


_CC = {}


def chord(name):
    if name not in _CC:
        _CC[name] = Chord(name)
    return _CC[name]


def chord_scale(key_pc, scale, ch):
    s = [mod12(key_pc + x) for x in scale]
    for pc in ch.pcs:
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
            g += 1
            x += d
    return x


def bass_note(pc, lo):
    return lo + mod12(pc - lo)


# 루트리스 보이싱(3·7도 + 텐션). 딸림화음은 다음 화음이 단조면 b9·b13, 아니면 9·13
ROOTLESS = {"maj7": [4, 7, 11, 14], "6": [4, 7, 9, 14], "m7": [3, 7, 10, 14], "m6": [3, 7, 9, 14],
            "7": [4, 9, 10, 14], "7alt": [4, 8, 10, 13]}


def voicing(ch, center, n, nxt=None, rootless=True):
    q = ch.q
    if q == "7" and nxt is not None and nxt.q in ("m7", "m6") and mod12(nxt.r - ch.r) == 5:
        q = "7alt"
    ivs = ROOTLESS.get(q, ch.iv[1:])
    pcs = []
    for x in ivs:
        pc = mod12(ch.r + x)
        if pc not in pcs:
            pcs.append(pc)
        if len(pcs) >= n:
            break
    if not rootless:
        pcs.insert(0, ch.r)
    out = sorted(nearest_pc(center, [pc]) for pc in pcs)
    for i in range(1, len(out)):
        while out[i] <= out[i - 1]:
            out[i] += 12
    return out


# ───────────────────────── 곡 데이터(cafe) + 5분 편곡 ─────────────────────────

RH = ["x--x-x--x---x---|x-----x-x-------", "..x-x-x-x---x---|x-x-x---x-------",
      "x-x-x-x-x-------|..x-x-x-x---x---", "x---x-x---x-x---|x-----x-x-----.."]
PROGS = {"I": "Ebmaj7 Ebm6 Dm7-G7 Cm7-F7", "A": "Bbmaj7 Gm7 Cm7 F7 Dm7 G7 Cm7 F7",
         "A2": "Bbmaj7 Gm7 Cm7 F7 Fm7-Bb7 Ebmaj7-Ebm6 Cm7-F7 Bb6",
         "B": "D7 D7 G7 G7 C7 C7 Cm7 F7", "X": "Cm7 F7 Bbmaj7 G7 Cm7 F7 Bb6 F7",
         "O": "Cm7 F7 Dm7 G7 Cm7 F7 Dm7 G7 Cm7 F7 Bbmaj7 Bbmaj7",
         "C": "Ebmaj7 Ebm6 Dm7-G7 Cm7-F7 Ebmaj7 Ebm6 Cm7-F7 Bb6"}
PROGS = {k: v.split(" ") for k, v in PROGS.items()}

# (이름, 마디 수, 진행, 켜는 갈래, 주제, 옥타브)
SECS = [
    ("루바토 인트로", 8, "I", "rubato", None, 0),
    ("인트로", 4, "I", "intro comp bass2 swish", None, 0),
    ("헤드 A", 8, "A", "comp bass2 swish chick head", "H", 0),
    ("헤드 A2", 8, "A2", "comp walk swish tap chick head", "H", 0),
    ("헤드 B", 8, "B", "comp walk swish tap chick head", "HB", 0),
    ("헤드 A2", 8, "A2", "comp walk swish tap chick head", "H", 0),
    ("솔로 A", 8, "A", "comp walk ride chick solo", None, 0),
    ("솔로 A2", 8, "A2", "comp walk ride chick solo", None, 0),
    ("솔로 B", 8, "B", "comp walk ride chick solo hot", None, 0),
    ("솔로 A2", 8, "A2", "comp walk ride chick solo hot", None, 0),
    ("베이스 브레이크", 8, "X", "comp stab walk swish tap", None, 0),
    ("헤드 A(회상)", 8, "A", "comp walk ride chick head", "H", 12),
    ("헤드 A2", 8, "A2", "comp walk swish tap chick head", "H", 0),
    ("아웃트로", 12, "O", "comp walk swish tap chick", None, 0),
    ("루바토 코다", 8, "C", "rubato coda", "H", 0),
]
SEC_TEXT = [
    "EP 단독 루바토(낮은 근음부터 굴린 화음·리타르단도 필), 비트 없음",
    "제 박자 진입: 굴린 EP 화음, 투필 베이스(근음·5도), 브러시 스윕 시작",
    "비브라폰 주제(묻고 답하기), EP 루트리스 컴핑, 투필 베이스, 2·4 칙",
    "워킹 베이스·브러시 탭(2·4) 진입, 주제 A2(ii–V 맺음)",
    "브리지 D7–G7–C7–F7, 주제 B",
    "헤드 A2 반복, 솔로 앞 정리",
    "라이드 레가토로 전환, EP 리드 즉흥(8분 스윙)",
    "솔로 계속, 마스터 세기 점점 올라감",
    "클라이맥스: 셋잇단 경과음이 섞인 솔로, 곡 중 가장 큰 구간(+1 dB 안팎)",
    "클라이맥스 유지 후 ii–V–I 로 정리",
    "EP 짧은 스탭, 워킹 베이스 전면, 브러시로 복귀",
    "주제를 비브라폰 한 옥타브 위로 회상, 라이드",
    "주제 A2 마지막 제시, 브러시",
    "Cm7–F7–Dm7–G7 되풀이, 드럼 줄어듦, 마지막 마디 Bbmaj7 맺음",
    "EP 루바토 + 비브라폰 주제 조각, Bb6 → 처음 Ebmaj7 로 이어짐",
]

MAP = []  # 마디 → (섹션 번호, 섹션 안 마디)
for si, s in enumerate(SECS):
    for b in range(s[1]):
        MAP.append((si, b))
assert len(MAP) == BARS


def sec_on(si):
    return set(SECS[si][3].split())


def bar_chords(si, bl):
    names = PROGS[SECS[si][2]][bl % len(PROGS[SECS[si][2]])].split("-")
    L = 16 / len(names)
    return [{"s": i * L, "len": L, "ch": chord(n)} for i, n in enumerate(names)]


def half_at(halves, s):
    h = halves[0]
    for x in halves:
        if x["s"] <= s:
            h = x
    return h


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


def make_motif(r):
    rh = parse_rh(pick(r, RH))
    out = []
    for i, (s, l) in enumerate(rh):
        mv = 0 if i == 0 else pick(r, [1, 1, 2, -1, 3, 0, 1] if i < len(rh) / 2 else [-1, -1, -2, 1, -3, 0, -1])
        out.append({"s": s, "l": l, "mv": mv})
    return out


_TH = {}


def theme(th):
    if th not in _TH:
        _TH[th] = {"m1": make_motif(rng_of("cafe", th, 1)), "m2": make_motif(rng_of("cafe", th, 2))}
    return _TH[th]


def realize(si, th, chunk, o):
    T, k = theme(th), chunk % 4
    mot = T["m1"] if k in (0, 2) else T["m2"]
    nb = SECS[si][1]
    b0 = bar_chords(si, chunk * 2)
    b1 = bar_chords(si, chunk * 2 + 1) if chunk * 2 + 1 < nb else b0
    ch_at = lambda s: (half_at(b0, s) if s < 16 else half_at(b1, s - 16))["ch"]
    vr = rng_of("cafe", th, "v", k)
    cur = nearest_pc(o["center"] + (2 if k == 2 else 0), ch_at(0).pcs)
    out = []
    for i, n in enumerate(mot):
        ch = ch_at(n["s"])
        pcs = chord_scale(KEY % 12, SCALE_MAJOR, ch)
        mv = n["mv"]
        if k == 2 and i >= len(mot) - 3:
            mv = pick(vr, [-1, 1, 2, -2])
        if i > 0:
            cur = step_in(cur, mv, pcs)
        if n["s"] % 8 == 0 or n["l"] >= 6:
            cur = nearest_pc(cur, ch.pcs)
        while cur > o["hi"]:
            cur -= 12
        while cur < o["lo"]:
            cur += 12
        out.append({"s": n["s"], "l": min(n["l"], 32 - n["s"]), "m": cur})
    if k == 3 and out:
        last = out[-1]
        ch = ch_at(last["s"])
        last["m"] = nearest_pc(last["m"], [ch.r, ch.pcs[1]])
        last["l"] = max(last["l"], min(12, 32 - last["s"]))
    for n in out:
        n["m"] += o.get("oct", 0)
    return out


_TN = {}


def theme_notes(si, bl, th, o):
    key = (si, bl >> 1, th, o.get("oct", 0))
    if key not in _TN:
        _TN[key] = realize(si, th, bl >> 1, o)
    off = (bl & 1) * 16
    return [{"s": n["s"] - off, "l": n["l"], "m": n["m"]} for n in _TN[key] if off <= n["s"] < off + 16]


SW3 = [0, 1.33, 2.67, 3.33]


def swing(s):
    whole = math.floor(s)
    pos = whole % 4
    return whole - pos + SW3[pos] + (s - whole)


# ───────────────────────── 악보 생성(genCafe 이식 + 루바토) ─────────────────────────

def compose_events():
    """[(시각초, 악기, midi, 길이초, 세기, 팬)]"""
    ev = []
    st = {"bm": 46, "vc": 62, "so": None}
    for bi in range(BARS):
        si, bl = MAP[bi]
        name, nbars = SECS[si][0], SECS[si][1]
        on = sec_on(si)
        halves = bar_chords(si, bl)
        nsi, nbl = MAP[(bi + 1) % BARS]
        nxt = bar_chords(nsi, nbl)[0]["ch"]
        r = rng_of("cafe", "bar", bi)
        bar_t = bi * BAR
        last = bl == nbars - 1
        bev = []

        def E(s, ins, m, l, v, pan=0.0):
            bev.append([s, ins, m, l, v, pan])

        if "rubato" in on:
            rubato_bar(ev, bi, bl, si, halves, nxt, r, st, last and "coda" in on)
            if "coda" in on and bl >= 4:   # 코다 후반: 주제 조각을 비브라폰으로(느슨한 박)
                for n in theme_notes(si, bl, "H", {"lo": 65, "hi": 79, "center": 72}):
                    t = bar_t + swing(n["s"]) * STEP + float(rng.normal(0, 0.025)) + 0.04
                    ev.append((t, "vibe", n["m"], n["l"] * STEP, 0.05 * (1 - 0.12 * (bl - 4)), -0.25))
            continue

        end_bar = name == "아웃트로" and last
        if end_bar:
            h = halves[0]
            for i, m in enumerate(voicing(h["ch"], 62, 4, nxt)):
                E(i * 0.3, "ep", m, 28, 0.05, -0.3 + 0.2 * i)
            E(0, "upright", bass_note(h["ch"].r, 34), 16, 0.2)
            E(0, "vibe", nearest_pc(77, [h["ch"].r]), 24, 0.06, -0.25)
            E(0, "ride", 0, 1, 0.03, 0.35)
        else:
            if "comp" in on:
                CP = [[[0, 3], [6, 4]], [[2, 3], [8, 6]], [[4, 3], [10, 4]], [[0, 2], [6, 2], [12, 3]], [[6, 6]], [[0, 5], [10, 3]]]
                intro = "intro" in on
                pat = [[0, 15]] if intro else [[0, 2]] if "stab" in on else CP[int(r() * len(CP))]
                for s, l in pat:
                    h = half_at(halves, s)
                    nc = nxt
                    for x in halves:
                        if x["s"] > h["s"]:
                            nc = x["ch"]
                            break
                    vs = voicing(h["ch"], st["vc"], 4, nc)
                    st["vc"] = round(st["vc"] * 0.6 + (sum(vs) / len(vs)) * 0.4 + (62 - st["vc"]) * 0.2)
                    for i, m in enumerate(vs):
                        E(s + i * (0.3 if intro else 0.08), "ep", m, l, 0.05 if intro else 0.042, -0.35 + 0.23 * i)
            if "bass2" in on:
                for h in halves:
                    root = bass_note(h["ch"].r, 34)
                    E(h["s"], "upright", root, h["len"] / 2, 0.18)
                    E(h["s"] + h["len"] / 2, "upright", root + 7, h["len"] / 2, 0.15)
            if "walk" in on:
                for q in range(4):
                    s = q * 4
                    h = half_at(halves, s)
                    change = s == h["s"]
                    if s + 4 < 16:
                        h2 = half_at(halves, s + 4)
                        next_ch = h2["ch"] if h2["s"] == s + 4 else None
                    else:
                        next_ch = nxt
                    if change:
                        m = nearest_pc(st["bm"], [h["ch"].r])
                    elif next_ch is not None:
                        tg = nearest_pc(st["bm"], [next_ch.r])
                        m = tg + (-1 if tg >= st["bm"] else 1) if r() < 0.7 else tg + (-2 if tg >= st["bm"] else 2)
                    else:
                        pool = h["ch"].pcs[1:]
                        m = nearest_pc(st["bm"] + pick(r, [-3, -2, 2, 3, 4]), pool)
                        if m == st["bm"]:
                            m = nearest_pc(st["bm"] + 3, pool)
                    while m > 52:
                        m -= 12
                    while m < 33:
                        m += 12
                    st["bm"] = m
                    E(s, "upright", m, 4, 0.2 if q == 0 else 0.17)
            if "swish" in on:
                for q in range(4):
                    E(q * 4, "swish", 0, 4, 0.024 if q % 2 else 0.018, 0.0)
            if "tap" in on:
                E(4, "brush", 0, 1, 0.045, -0.1)
                E(12, "brush", 0, 1, 0.045, -0.1)
                if r() < 0.3:
                    E(14, "brush", 0, 1, 0.02, -0.1)
            if "ride" in on:
                for s in (0, 4, 6, 8, 12, 14):
                    E(s, "ride", 0, 1, 0.02 if s % 4 == 2 else 0.03, 0.35)
            if "chick" in on:
                E(4, "chick", 0, 1, 0.03, -0.3)
                E(12, "chick", 0, 1, 0.03, -0.3)
            if "swish" in on or "ride" in on:
                E(0, "fkick", 0, 1, 0.07)
                E(8, "fkick", 0, 1, 0.06)
            if "head" in on:
                th, oc = SECS[si][4], SECS[si][5]
                for n in theme_notes(si, bl, th, {"lo": 65, "hi": 82, "center": 72, "oct": oc}):
                    E(n["s"], "vibe", n["m"], n["l"], 0.07 if oc == 0 else 0.06, -0.25)
            if "solo" in on:
                so = st["so"] or {"m": 70, "dir": 1}
                st["so"] = so
                rest_back = bl % 4 == 3 and r() < 0.6
                hot = "hot" in on
                for s in range(0, 16, 2):
                    if last and s >= 6:
                        break
                    if (rest_back and s >= 8) or r() < 0.1:
                        continue
                    h = half_at(halves, s)
                    pcs = chord_scale(KEY % 12, SCALE_MAJOR, h["ch"])
                    if s == 14 and nxt is not None:
                        tg = nearest_pc(so["m"] + so["dir"], nxt.pcs)
                        m = tg + (-1 if so["dir"] > 0 else 1)
                    elif s % 4 == 0:
                        m = nearest_pc(so["m"] + so["dir"] * 2, h["ch"].pcs)
                    else:
                        m = step_in(so["m"], so["dir"], pcs)
                    if m > 84 or m < 62:
                        so["dir"] = -so["dir"]
                        m = step_in(so["m"], so["dir"], pcs)
                    if r() < 0.22:
                        so["dir"] = -so["dir"]
                    # 클라이맥스: 앞 박을 셋잇단으로 채우는 경과음(가운데 셋잇단 자리, 스윙 미적용)
                    if hot and s % 4 == 0 and s > 0 and r() < 0.3:
                        E(s - 8 / 3, "epLead", step_in(so["m"], -so["dir"], pcs), 1.2, 0.04, 0.2)
                        bev[-1].append("trip")
                    so["m"] = m
                    E(s, "epLead", m, 4 if (rest_back and s == 6) else 2, 0.06 if s % 4 == 2 else 0.052, 0.2)
        # 스윙·인간화
        for e in bev:
            s, ins, m, l, v, pan = e[:6]
            sw = s if len(e) > 6 else swing(s)
            t = bar_t + sw * STEP + float(rng.uniform(-0.004, 0.004))
            ev.append((t, ins, m, l * STEP, v * float(rng.uniform(0.92, 1.06)), pan))
    ev.sort(key=lambda e: e[0])
    return ev


def rubato_bar(ev, bi, bl, si, halves, nxt, r, st, final):
    """EP 루바토: 화음을 낮은 근음부터 굴리고(페달 길게), 화음 하나짜리 마디는 위 성부에 짧은 필."""
    bar_t = bi * BAR
    for hi, h in enumerate(halves):
        nc = halves[hi + 1]["ch"] if hi + 1 < len(halves) else nxt
        t0 = bar_t + h["s"] * STEP + 0.03 + 0.10 * r()
        spread = (0.13 if final else 0.055) + 0.05 * r()
        root = bass_note(h["ch"].r, 38)
        vs = voicing(h["ch"], 61, 4, nc)
        hold = h["len"] * STEP + (2.6 if final else 0.7)
        ev.append((t0, "ep", root, hold, 0.045, -0.15))
        ev.append((t0 + 0.02, "ep", root + 12 if root + 12 < vs[0] else root + 7, hold, 0.022, 0.1))
        for i, m in enumerate(vs):
            ev.append((t0 + (i + 1) * spread, "ep", m, hold - (i + 1) * spread, 0.045 * (1 - 0.06 * i), -0.3 + 0.2 * i))
        st["vc"] = round(sum(vs) / len(vs))
    if len(halves) == 1 and not final and r() < 0.85:
        ch = halves[0]["ch"]
        pcs = chord_scale(KEY % 12, SCALE_MAJOR, ch)
        k = 3 + int(r() * 3)
        m = nearest_pc(76 + int(r() * 4), ch.pcs)
        d = -1 if r() < 0.6 else 1
        t = bar_t + BAR * (0.45 + 0.1 * r())
        gap = 0.26 + 0.08 * r()
        for j in range(k):
            ln = gap * 1.2 if j < k - 1 else 1.4
            ev.append((t, "ep", m, ln, 0.038 * (1 - 0.08 * j), 0.15))
            t += gap
            gap *= 1.12 + 0.1 * r()        # 리타르단도
            m = step_in(m, d, pcs)
    st["bm"] = 46


# ───────────────────────── 악기 합성 ─────────────────────────

def env_target(n, a, peak, tau, sus, end, rel):
    """music.js adsr(): 선형 어택 → sus 로 지수 접근 → end 이후 rel 시정수로 0."""
    t = np.arange(n) / SR
    end = max(end, a + 0.01)
    e = np.where(t < a, peak * t / a, peak * (sus + (1 - sus) * np.exp(-(t - a) / tau)))
    ve = peak * (sus + (1 - sus) * math.exp(-(end - a) / tau))
    e = np.where(t >= end, ve * np.exp(-(t - end) / rel), e)
    k = min(n, int(0.006 * SR))
    e[-k:] *= np.linspace(1, 0, k)
    return e


def ep_note(m, dur, v, lead=False):
    f = mtof(m) * 2 ** (float(rng.normal(0, 2.5)) / 1200)
    if lead:   # epLead: 변조 배율 2, 지수 1.4→0.15 (0.12초)
        rel, a, tau, sus, ratio, i0, i1, it = 0.08, 0.005, 0.6, 0.45, 2.0, 1.1, 0.15, 0.12
    else:      # ep: 변조 배율 1, 지수 1.6→0.22 (0.22초)
        rel, a, tau, sus, ratio, i0, i1, it = 0.12, 0.006, 0.9, 0.3, 1.0, 1.35, 0.22, 0.22
    n = int((dur + rel * 5) * SR)
    t = np.arange(n) / SR
    i0 *= 0.75 + 4.0 * min(v, 0.07)       # 세게 칠수록 조금 밝게
    idx = i1 + (i0 - i1) * np.exp(-t / it)
    if f > 700:                            # 고음 금속성 억제
        idx *= 700 / f
    w = 2 * np.pi * f * t
    y = np.sin(w + idx * np.sin(ratio * w))
    y += 0.12 * np.sin(2 * w) * np.exp(-t / 0.5)  # 둥근 몸통
    env = env_target(n, a, v, tau, sus, dur, rel)
    return (y * env).astype(F32)


def vibe_note(m, dur, v):
    dur = max(dur, 0.5)
    f = mtof(m)
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    p4 = 0.1 * min(1.0, 600 / f)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9) + p4 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / 0.07)
    att = np.clip(t / 0.004, 0, 1)
    rel = np.where(t > dur, np.exp(-(t - dur) / 0.12), 1.0)
    trem = 1 - 0.16 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.2 * t))
    e = att * rel * trem
    k = int(0.006 * SR)
    e[-k:] *= np.linspace(1, 0, k)
    return (y * e * v).astype(F32)


def upright_note(m, dur, v):
    """둥근 업라이트: 삼각파 계열 배음, 배음일수록 빨리 어두워짐 + 살짝 내려앉는 음높이."""
    f = mtof(m)
    rel = 0.05
    end = dur * 0.92
    n = int((end + rel * 5) * SR)
    t = np.arange(n) / SR
    bend = 1 + 0.006 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f * bend) / SR
    y = np.zeros(n)
    for k, a in ((1, 1.0), (2, 0.32), (3, 0.13), (4, 0.06), (5, 0.03)):
        y += a * np.sin(k * ph) * (0.25 + 0.75 * np.exp(-t / (0.22 / k)))
    thump = np.sin(2 * np.pi * f * 0.5 * t) * np.exp(-t / 0.04) * 0.25
    env = env_target(n, 0.008, v, 0.25, 0.45, end, rel)
    return ((y + thump) * env).astype(F32)


def fkick(v):
    tau = 0.09
    n = int(tau * 5 * SR)
    t = np.arange(n) / SR
    f = np.maximum(45.0, 80.0 * (45 / 80) ** (t / (tau * 1.2)))
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.clip(t / 0.004, 0, 1) * np.exp(-t / tau)
    e[-200:] *= np.linspace(1, 0, 200)
    return (np.sin(ph) * e * v).astype(F32)


def ride_tone(v):
    """라이드 금속음: 비조화 부분음 여럿을 타격마다 조금씩 어긋나게(고정 음정으로 들리지 않게), 작게."""
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for fr, a, tau in ((1870, 0.5, 0.2), (2960, 1.0, 0.14), (3517, 0.7, 0.16), (4211, 0.5, 0.12), (4730, 0.4, 0.1),
                       (5130, 0.3, 0.1), (6020, 0.2, 0.08), (2410, 0.4, 0.18)):
        f2 = fr * (1 + float(rng.uniform(-0.03, 0.03)))
        y += a * np.sin(2 * np.pi * f2 * t + float(rng.uniform(0, 6.28))) * np.exp(-t / tau)
    y *= np.clip(t / 0.003, 0, 1)
    y[-500:] *= np.linspace(1, 0, 500)
    return (y * v * 0.05).astype(F32)


def nz_env(t_len, a, tau):
    n = int((a + tau * 6) * SR)
    t = np.arange(n) / SR
    e = np.where(t < a, t / a, np.exp(-(t - a) / tau))
    e[-100:] *= np.linspace(1, 0, 100)
    return e.astype(F32)


# 잡음 악기: (어택, 감쇠 시정수, 고역통과, 저역통과, 세기 보정)
NZ = {"swish": (0.14, 0.22, 1300, 4200, 0.8), "brush": (0.005, 0.05, 900, 3800, 1.1),
      "chick": (0.004, 0.022, 3500, 6500, 0.8), "ride": (0.003, 0.22, 4500, 9500, 0.45)}


def render_events(ev, log):
    buses = {k: new_bus() for k in ("keys", "lead", "vibe", "bass", "kick", "ridet")}
    nzenv = {k: np.zeros(N, dtype=F32) for k in NZ}
    nzpan = {"swish": 0.0, "brush": -0.1, "chick": -0.3, "ride": 0.35}
    cache = {}
    cnt = {}
    for t, ins, m, d, v, pan in ev:
        cnt[ins] = cnt.get(ins, 0) + 1
        if ins == "ep":
            add(buses["keys"], t, ep_note(m, d, v), pan)
        elif ins == "epLead":
            add(buses["lead"], t, ep_note(m, d, v, lead=True), pan)
        elif ins == "vibe":
            add(buses["vibe"], t, vibe_note(m, d, v), pan)
        elif ins == "upright":
            add(buses["bass"], t, upright_note(m, d, v), 0.0)
        elif ins == "fkick":
            add(buses["kick"], t, fkick(v), 0.0)
        elif ins in NZ:
            a, tau, _, _, g = NZ[ins]
            key = ins
            if key not in cache:
                cache[key] = nz_env(0, a, tau)
            add_mono(nzenv[ins], t, cache[key] * F32(v * g))
            if ins == "ride":
                add(buses["ridet"], t, ride_tone(v), 0.35)
    log("  음 개수: " + ", ".join(f"{k} {v}" for k, v in sorted(cnt.items())))
    f = freqs()
    drums = new_bus()
    tt = np.arange(N, dtype=np.float64) / SR
    for ins, (a, tau, hp, lp, g) in NZ.items():
        noise = rng.standard_normal(N).astype(F32)
        if ins == "swish":   # 브러시 원 그리기: 두 대역을 박마다 엇갈려 섞어 색이 돈다
            lo = fd_filter(noise, hp_mag(f, 900, 1) * lp_mag(f, 2600, 2))
            hi = fd_filter(noise, hp_mag(f, 2200, 1) * lp_mag(f, 4800, 2))
            x = (0.5 + 0.5 * np.cos(2 * np.pi * tt / BEAT)).astype(F32)
            sig = (lo * x + hi * (1 - x) * 0.8) * nzenv[ins]
            del lo, hi, x
        else:
            sig = fd_filter(noise * nzenv[ins], hp_mag(f, hp, 2) * lp_mag(f, lp, 2))
        gl, gr = pan_gains(nzpan[ins])
        drums[0] += sig * F32(gl)
        drums[1] += sig * F32(gr)
        del noise, sig
    drums += fd_filter(buses.pop("ridet"), lp_mag(f, 7000, 2))
    return buses, drums


# ───────────────────────── 이펙트·측정·마스터링(compose.py 에서 복사) ─────────────────────────

def reverb_ir(length=3.0, rt60_lo=2.1, rt60_hi=0.8):
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
        for k, ms in enumerate((9, 15, 23, 31, 43, 59, 73)):
            idx = int((ms + (3 if ch else 0)) * SR / 1000)
            ir[ch, idx] += 0.5 * (0.8 ** k) * (1 if (k + ch) % 2 else -1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir.astype(F32)


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

def sec_bounds():
    """세부 섹션 (이름, 시작 마디, 끝 마디)."""
    out, b = [], 0
    for s in SECS:
        out.append((s[0], b, b + s[1]))
        b += s[1]
    return out


def render(log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()
    ev = compose_events()
    st(f"악보 {len(ev)}음")
    buses, drums = render_events(ev, log)
    st("악기 합성")

    mix = new_bus()
    rev = new_bus()
    a0, a1 = int(tb(60) * SR), int(tb(76) * SR)

    def busrms(nm, x):
        seg = x[:, a0:a1].astype(np.float64)
        log(f"    버스 {nm:6s} 클라이맥스 RMS {db(math.sqrt(float((seg ** 2).mean()))):6.1f} dB")

    # 갈래별 세기 자동화(마디 단위)
    keys = fd_filter(buses.pop("keys"), lp_mag(f, 4200, 1) * hp_mag(f, 60, 1))
    tt = np.arange(N, dtype=np.float64) / SR
    tf = loopf(4.8)
    trem = 0.18 * (0.5 + 0.5 * np.sin(2 * np.pi * tf * tt))
    keys[0] *= (1 - trem).astype(F32)
    keys[1] *= (1 - 0.18 + trem).astype(F32)
    del trem
    keys *= automation([(0, 1.0), (12, 1.0), (52, 0.9), (60, 0.95), (76, 1.05), (84, 1.0), (112, 1.0), (120, 1.0)])[None, :]
    mix += 1.2 * keys
    busrms("keys", 1.2 * keys)
    rev += 0.35 * keys
    del keys
    lead = fd_filter(buses.pop("lead"), lp_mag(f, 3800, 2) * hp_mag(f, 150, 1))
    lead *= automation([(0, 0.9), (52, 0.95), (60, 1.05), (76, 1.0), (120, 1.0)])[None, :]
    mix += 0.8 * lead
    busrms("lead", 0.8 * lead)
    rev += 0.4 * lead
    del lead
    vibe = fd_filter(buses.pop("vibe"), lp_mag(f, 5000, 1))
    mix += 0.8 * vibe
    busrms("vibe", 0.8 * vibe)
    rev += 0.5 * vibe
    del vibe
    bass = fd_filter(buses.pop("bass"), lp_mag(f, 1100, 2) * hp_mag(f, 32, 2))
    bass *= automation([(0, 1.0), (76, 1.0), (77, 1.15), (83, 1.15), (84, 1.0), (120, 1.0)])[None, :]
    mix += 0.8 * bass
    busrms("bass", 0.8 * bass)
    rev += 0.05 * bass
    del bass
    kick = fd_filter(buses.pop("kick"), hp_mag(f, 30, 2))
    # 6kHz 위 하이셸프 −5dB + 로우패스 8kHz: 브러시·칙 잡음의 고역 피로 줄이기
    rr = (f / 6000.0) ** 4
    shelf = 1 + (10 ** (-5 / 20) - 1) * rr / (1 + rr)
    drums = fd_filter(drums, lp_mag(f, 8000, 2) * shelf)
    del rr, shelf
    dr = automation([(0, 0.0), (8, 0.0), (8.01, 0.45), (12, 0.75), (20, 0.85), (44, 0.9), (60, 1.0), (76, 1.0),
                     (77, 0.85), (84, 0.95), (100, 0.9), (112, 0.6), (120, 0.0)])
    drums *= dr[None, :]
    kick *= dr[None, :]
    del dr
    mix += 0.8 * kick + 2.0 * drums
    busrms("kick", 0.8 * kick)
    busrms("drums", 2.0 * drums)
    rev += 0.05 * kick + 0.6 * drums
    del kick, drums
    st("버스 정리")

    wet = circ_conv(rev, reverb_ir())
    wet = fd_filter(wet, hp_mag(f, 150, 1) * lp_mag(f, 7000, 1))
    mix += 0.30 * wet
    del wet, rev
    st("리버브")

    # 마스터: 처음과 끝(루바토 EP)은 같은 수준
    mix *= automation([(0, 0.78), (8, 0.8), (12, 0.86), (20, 0.88), (44, 0.9), (52, 0.96), (60, 1.06), (76, 1.0), (84, 0.94),
                       (108, 0.88), (112, 0.8), (120, 0.78)])[None, :]
    mix = fd_filter(mix, hp_mag(f, 25, 2) * lp_mag(f, 13000, 1))

    lufs0 = loudness(mix)
    mix *= F32(10 ** ((TARGET_LUFS - lufs0) / 20))
    ceil = 10 ** (CEIL_DB / 20)
    mix, gr = limiter(mix, ceil)
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
    st(f"마스터 (리미터 최대 GR {gr:.2f} dB)")
    return mix, gr


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


def db(v):
    return 20 * math.log10(max(v, 1e-12))


def fmt_t(s):
    s = int(round(s))
    return f"{s // 60}:{s % 60:02d}"


def stft_power(x, nfft=4096, hop=2205):
    mono = x.astype(np.float64).mean(axis=0)
    nfr = (len(mono) - nfft) // hop + 1
    win = np.hanning(nfft)
    P = np.empty((nfr, nfft // 2 + 1), dtype=np.float32)
    for i0 in range(0, nfr, 512):
        i1 = min(nfr, i0 + 512)
        idx = (np.arange(i0, i1) * hop)[:, None] + np.arange(nfft)[None, :]
        P[i0:i1] = (np.abs(np.fft.rfft(mono[idx] * win, axis=1)) ** 2).astype(np.float32)
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    tt = (np.arange(nfr) * hop + nfft / 2) / SR
    return P, fr, tt


def analyze(x, log=print):
    res = {}
    rows = []
    bounds = [s for _, s in SECTIONS] + [BARS]
    for k, (name, b0) in enumerate(SECTIONS):
        i0, i1 = int(tb(b0) * SR), int(tb(bounds[k + 1]) * SR)
        seg = x[:, i0:i1].astype(np.float64)
        rows.append((name, b0, bounds[k + 1], db(math.sqrt(float((seg ** 2).mean()))), db(float(np.abs(seg).max())), loudness(seg)))
    res["sections"] = rows
    sub = []
    for name, b0, b1 in sec_bounds():
        seg = x[:, int(tb(b0) * SR):int(tb(b1) * SR)].astype(np.float64)
        sub.append((name, b0, b1, db(math.sqrt(float((seg ** 2).mean()))), loudness(seg)))
    res["subsections"] = sub
    xx = x.astype(np.float64)
    res["total"] = (db(math.sqrt(float((xx ** 2).mean()))), db(float(np.abs(xx).max())), loudness(x))
    del xx
    res["win15"] = [db(math.sqrt(float((x[:, w * 15 * SR:(w + 1) * 15 * SR].astype(np.float64) ** 2).mean()))) for w in range(20)]
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    res["seam"] = {"end50_rms": db(math.sqrt((a ** 2).mean())), "start50_rms": db(math.sqrt((b ** 2).mean())),
                   "jump": float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max()),
                   "typ_diff": float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max()),
                   "end1s_lufs": loudness(x[:, -SR:]), "start1s_lufs": loudness(x[:, :SR])}
    P, fr, tt = stft_power(x)
    cen = (P * fr[None, :]).sum(1) / np.maximum(P.sum(1), 1e-20)
    pw = P.sum(1)
    def cen_range(t0, t1):
        m = (tt >= t0) & (tt < t1)
        return float((cen[m] * pw[m]).sum() / max(pw[m].sum(), 1e-20))
    res["centroid"] = [(n, cen_range(tb(b0), tb(b1))) for n, b0, b1 in
                       [(nm, b0, bounds[k + 1]) for k, (nm, b0) in enumerate(SECTIONS)]]
    res["centroid_sub"] = [(n, cen_range(tb(b0), tb(b1))) for n, b0, b1 in sec_bounds()]
    res["centroid_all"] = float((cen * pw).sum() / pw.sum())
    hi = fr >= 8000
    res["hf_ratio_db"] = db(math.sqrt(float(P[:, hi].sum() / P.sum())))
    res["_stft"] = (P, fr, tt)
    log("\n구간별: " + "  ".join(f"{n} RMS {r:.1f} LUFS {l:.1f}" for n, _, _, r, _, l in rows))
    log("전체 RMS %.2f dBFS, 피크 %.2f dBFS, %.2f LUFS" % res["total"])
    log("루프 이음매: " + ", ".join(f"{k} {v:.5f}" for k, v in res["seam"].items()))
    log("스펙트럼 중심: " + ", ".join(f"{n} {c:.0f}Hz" for n, c in res["centroid"]))
    return res


def plot(res, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    P, fr, tt = res["_stft"]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(15, 8), sharex=True, gridspec_kw={"height_ratios": [3, 1.2]})
    m = fr <= 12000
    S = 10 * np.log10(np.maximum(P[:, m].T, 1e-12))
    vmax = np.percentile(S, 99.7)
    ax1.imshow(S, origin="lower", aspect="auto", extent=[0, DUR, 0, fr[m][-1] / 1000], cmap="magma",
               vmin=vmax - 90, vmax=vmax)
    ax1.set_ylabel("주파수 (kHz)")
    ax1.set_title(f"{TITLE} — 스펙트로그램(0～12 kHz)과 RMS")
    for nm, b0, b1 in sec_bounds():
        for ax in (ax1, ax2):
            ax.axvline(tb(b0), color="#9cc" if ax is ax1 else "#999", lw=0.6, ls=":")
        ax1.text(tb(b0) + 1, fr[m][-1] / 1000 * 0.96, nm, color="white", fontsize=7, va="top", rotation=90)
    for nm, b0 in SECTIONS:
        ax2.axvline(tb(b0), color="#333", lw=1.2)
        ax2.text(tb(b0) + 2, -14.5, nm, fontsize=11, weight="bold")
    # 1초 RMS 와 15초 창 RMS
    x1 = res["_rms1"]
    ax2.plot(np.arange(len(x1)) + 0.5, x1, color="#3a6ea5", lw=0.9, label="1초 창 RMS")
    ax2.step(np.arange(21) * 15, list(res["win15"]) + [res["win15"][-1]], where="post", color="#c0392b", lw=1.6,
             label="15초 창 RMS")
    ax2.set_ylim(-45, -12)
    ax2.set_ylabel("RMS (dBFS)")
    ax2.set_xlabel("시간 (초)")
    ax2.set_xlim(0, DUR)
    ax2.legend(loc="lower center", fontsize=8, ncol=2)
    ax2.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def write_report(path, res, meta, mp3_info, gr, elapsed):
    L = []
    L.append(f"# {TITLE} — 합성 보고서\n")
    L.append(f"- 분위기: {MOOD}")
    L.append(f"- {BPM} BPM, 4/4, {BARS}마디 = {DUR:.0f}초, Bb major, 셋잇단 스윙(박 안 16분 자리 0·1.33·2.67·3.33), 시드 {SEED}")
    L.append(f"- 원곡 데이터: 이전 프로젝트 `music.js` cafe(genCafe) — 화음 진행·주제 동기(mulberry32 씨앗 그대로)·워킹 베이스·솔로 규칙 이식")
    L.append(f"- 실행 시간 {elapsed:.0f}초, 리미터 최대 GR {gr:.2f} dB\n")
    L.append("## 곡 구조\n")
    L.append("| 구간 | 세부 | 시간 | 마디 | 진행 | 내용 |")
    L.append("|---|---|---|---|---|---|")
    big = {b: n for n, b in SECTIONS}
    cur = ""
    for nm, b0, b1 in sec_bounds():
        if b0 in big:
            cur = big[b0]
        p = SECS[[x[1] for x in sec_bounds()].index(b0)][2]
        L.append(f"| {cur} | {nm} | {fmt_t(tb(b0))}～{fmt_t(tb(b1))} | {b0}～{b1 - 1} | {p} | {SEC_TEXT[[x[1] for x in sec_bounds()].index(b0)]} |")
    L.append("\n진행: " + "; ".join(f"**{k}** {' '.join(v)}" for k, v in PROGS.items()))
    L.append("\n보이싱: EP는 루트리스(3·7도+9·13 텐션, 단조로 가는 딸림화음은 b9·b13), 앞 화음 가운데에 가깝게 이어 쌓음. "
             "베이스는 박마다 화음음·반음 접근음으로 걷는 워킹(헤드 A까지는 근음·5도 투필).\n")
    L.append("## 구간별 RMS·LUFS\n")
    L.append("| 구간 | 시간 | RMS (dBFS) | 피크 (dBFS) | LUFS(근사) |")
    L.append("|---|---|---|---|---|")
    for n, b0, b1, r, p, l in res["sections"]:
        L.append(f"| {n} | {fmt_t(tb(b0))}～{fmt_t(tb(b1))} | {r:.2f} | {p:.2f} | {l:.2f} |")
    tr, tp, tl = res["total"]
    L.append(f"| 전체 | 0:00～5:00 | {tr:.2f} | {tp:.2f} | **{tl:.2f}** |\n")
    L.append("세부 섹션:\n")
    L.append("| 세부 | 마디 | RMS (dBFS) | LUFS | 스펙트럼 중심 (Hz) |")
    L.append("|---|---|---|---|---|")
    for (n, b0, b1, r, l), (_, c) in zip(res["subsections"], res["centroid_sub"]):
        L.append(f"| {n} | {b0}～{b1 - 1} | {r:.2f} | {l:.2f} | {c:.0f} |")
    L.append("\n## 15초 창 RMS 곡선\n")
    L.append("```")
    bounds = [s for _, s in SECTIONS]
    for w, r in enumerate(res["win15"]):
        bar = w * 15 / BAR
        sec = [n for n, b in SECTIONS if b <= bar][-1]
        L.append(f"{fmt_t(w * 15)} {sec} {r:7.2f} " + "■" * max(0, int(round(r + 40))))
    L.append("```")
    L.append("(■ 1칸 = 1 dB, 기준 −40 dBFS)\n")
    s = res["seam"]
    L.append("## 루프 이음매\n")
    L.append("곡 전체를 300초 원형 버퍼에 합성(끝 음·리버브 꼬리는 앞머리로 감김), 트레몰로 LFO는 300초 정수 주기. "
             "끝은 코다 Bb6 루바토, 처음은 Ebmaj7 루바토(Bb→Eb 4도 진행)라 화성도 이어집니다.\n")
    L.append("| 항목 | 값 |")
    L.append("|---|---|")
    L.append(f"| 끝 50ms RMS | {s['end50_rms']:.2f} dBFS |")
    L.append(f"| 처음 50ms RMS | {s['start50_rms']:.2f} dBFS |")
    L.append(f"| 끝 1초 / 처음 1초 라우드니스 | {s['end1s_lufs']:.2f} / {s['start1s_lufs']:.2f} LUFS |")
    L.append(f"| 경계 샘플 차(마지막→첫 샘플) | {s['jump']:.5f} |")
    L.append(f"| 참고: 처음 1초 안 인접 샘플 차 최대 | {s['typ_diff']:.5f} |")
    L.append("\nMP3 인코더 지연(약 25ms)은 남으므로 `<audio loop>` 재생에서 완전한 무간격은 아닙니다.\n")
    L.append("## 스펙트럼 중심(밝기)\n")
    L.append("| 구간 | 스펙트럼 중심 (Hz) |")
    L.append("|---|---|")
    for n, c in res["centroid"]:
        L.append(f"| {n} | {c:.0f} |")
    L.append(f"| 전체 | {res['centroid_all']:.0f} |")
    L.append(f"\n8 kHz 이상 에너지 비율: {res['hf_ratio_db']:.1f} dB (전체 대비). 그림: `spectrogram.png`.\n")
    L.append("## 파일·검사\n")
    L.append("| 항목 | 값 | 기준 | 결과 |")
    L.append("|---|---|---|---|")
    L.append(f"| MP3 길이 | {mp3_info['secs']:.3f}초 ({mp3_info['frames']}프레임) | 300±0.5초 | {'통과' if mp3_info['ok_len'] else '실패'} |")
    L.append(f"| MP3 크기 | {mp3_info['size']:,} bytes ({mp3_info['size'] / 1048576:.2f} MB) | 8 MB 이하 | {'통과' if mp3_info['ok_size'] else '실패'} |")
    L.append(f"| 샘플 피크(PCM) | {tp:.2f} dBFS | −1 dBFS 이하 | {'통과' if mp3_info['ok_peak'] else '실패'} |")
    L.append(f"| 통합 라우드니스 | {tl:.2f} LUFS | −16±1 | {'통과' if mp3_info['ok_lufs'] else '실패'} |")
    L.append(f"\n- 형식: 44.1kHz 스테레오, {BITRATE}kbps CBR (lameenc)")
    L.append(f"- MP3 sha256: `{mp3_info['sha']}`")
    L.append(f"- PCM sha256: `{mp3_info['pcm_sha']}`")
    L.append("- 피크는 인코딩 전 PCM 기준이며 MP3 오버슈트 여유로 −1.5 dBFS 상한을 씁니다(이 PC에 MP3 디코더가 없어 디코드 피크는 미측정).")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="재즈풍 작업 배경음악 합성")
    ap.add_argument("--out", default="bgm-jazz.mp3")
    ap.add_argument("--wav", default=None)
    ap.add_argument("--no-report", action="store_true")
    args = ap.parse_args(argv)
    t0 = time.time()
    print(f"합성 시작: {BPM} BPM, {BARS}마디, {DUR:.0f}초, seed {SEED}")
    mix, gr = render()
    res = analyze(mix)
    res["_rms1"] = [db(math.sqrt(float((mix[:, i * SR:(i + 1) * SR].astype(np.float64) ** 2).mean()))) for i in range(int(DUR))]
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
    meta = {"duration": int(DUR), "bpm": BPM, "key": "Bb major",
            "sections": [{"name": n, "start": int(tb(b))} for n, b in SECTIONS], "seed": SEED,
            "title": TITLE, "mood": MOOD}
    stem = os.path.splitext(os.path.basename(out))[0]
    with open(os.path.join(od, stem + ".json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs = mp3_frames(mp3)
    tr, tp, tl = res["total"]
    info = {"frames": frames, "secs": secs, "size": len(mp3), "sha": hashlib.sha256(mp3).hexdigest(),
            "pcm_sha": hashlib.sha256(pcm.tobytes()).hexdigest(),
            "ok_len": abs(secs - DUR) <= 0.5, "ok_size": len(mp3) <= 8 * 1024 * 1024,
            "ok_peak": tp <= -1.0, "ok_lufs": abs(tl - TARGET_LUFS) <= 1.0}
    print(f"\nMP3: {out}\n  크기 {len(mp3):,} bytes, 길이 {secs:.3f}초, sha256 {info['sha']}")
    if not args.no_report:
        plot(res, os.path.join(od, "spectrogram.png"))
        write_report(os.path.join(od, "report.md"), res, meta, info, gr, time.time() - t0)
    ok = all(info[k] for k in ("ok_len", "ok_size", "ok_peak", "ok_lufs"))
    print(f"  실행 {time.time() - t0:.0f}초, 검사:", "통과" if ok else "실패")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
