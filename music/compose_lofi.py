#!/usr/bin/env python3
"""'깊은 작업' 로파이 BGM 결정적 합성기 (5분 편곡).

원곡: 작성자의 이전 프로젝트 music.js 의 TRACKS.deep / genDeep
  (로파이 · 다운템포 코딩 앰비언트, 84 BPM, 16분 스윙 0.16, D dorian).
화음 진행·섹션·주제 선율 생성(mulberry32 + FNV 문자열 시드, makeMotif/realize)을 그대로 옮기고,
마스터링·원형 버퍼 루프·검사는 music/compose.py 를 복사해 재사용한다.

84 BPM 4/4 105마디 = 정확히 300초.
  기  인트로(0～8) · A(8～24)                    패드·EP → 소프트 하이햇 → 킥·스네어·서브 베이스 진입
  승  A·주제(24～40) · B(40～56)                 EP 리드 주제, B 진행·대선율·16분 고스트 햇
  전  브레이크(56～64) · A·다시(64～80) · B·끝(80～92)  비트 빠짐·필터 닫힘·아르페지오 → 비브라폰 주제 → 클라이맥스
  결  아웃트로(92～105)                          킥 1·3박만 남았다가 패드·EP로 Dm9 귀결(처음 Dm9로 이어짐)

사용법:
  python compose_lofi.py --out bgm-lofi.mp3 [--wav 미리듣기.wav]
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
BPM = 84
BEAT = 60.0 / BPM
BAR = 4 * BEAT                 # 2.857 s
STEP = BEAT / 4                # 16분음표
SWING = 0.16                   # 원곡 값: 홀수 16분을 16분의 0.16만큼 늦춘다
HAT_SWING8 = 0.30              # 하이햇 뒷 8분(16분 자리 2·6·10·14)을 16분의 0.30만큼 늦춘다(8분 스윙 느낌)
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
TITLE = "깊은 작업"
MOOD = "로파이 · 다운템포 코딩 앰비언트"

rng = np.random.default_rng(SEED)
F32 = np.float32

# ───────────────────────── 곡 데이터(원곡 TRACKS.deep, 섹션 길이만 5분용으로 조정) ─────────────────────────

RH = ['x--x---x-x--x---|x-------........', 'x-x-x---x-----..|..x-x-x-x-------',
      '..x--x--x---x---|x--x----........', 'x-----x-x-x-x---|x---------......']
PROGS = {"A": "Dm9 Gm9 Bbmaj7 A7sus4-A7".split(),
         "B": "Gm9 C9 Fmaj7 Bbmaj7 Em7b5 A7 Dm9 Dm9".split(),
         "C": "Bbmaj7 Am7 Gm9 A7sus4".split()}
MIXG = {"keys": 0.95, "lead": 0.8, "lead2": 0.55, "pad": 0.75, "bass": 1.0, "drum": 0.9, "perc": 0.7}
# 오프라인 믹스 보정(원곡은 노트북 스피커 기준이라 저역이 과함): 버스별 RMS 실측 후 킥·베이스를 낮추고 화음·주제·햇을 올림
BAL = {"keys": 1.25, "lead": 1.4, "lead2": 1.3, "pad": 1.4, "bass": 0.5, "drum": 0.6, "perc": 6.0}
SECS = [
    dict(n="인트로", bars=8, p="A", on="pad keys", filt=1200, vin=0.55, part="기",
         desc="판 잡음 속 Dm9 패드와 로즈 EP 화음, 5마디부터 아주 작은 하이햇"),
    dict(n="A", bars=16, p="A", on="pad keys bass drum2", filt=3000, vin=0.25, part="기",
         desc="둥근 킥·소프트 스네어·서브 베이스 진입, 필터가 열림"),
    dict(n="A · 주제", bars=16, p="A", on="pad keys bass drum2 lead", th="A", filt=3600, vin=0.2, part="승",
         desc="EP 리드가 주제 A(물음·대답 4덩어리 악구)를 연주"),
    dict(n="B", bars=16, p="B", on="pad keys bass drum3 lead counter", th="B", filt=4200, vin=0.2, part="승",
         desc="B 진행(Gm9–C9–Fmaj7–Bbmaj7–Em7b5–A7–Dm9), 주제 B·플루트 대선율·고스트 햇·오픈 햇"),
    dict(n="브레이크", bars=8, p="C", on="pad arp", filt=1000, vin=0.6, part="전",
         desc="비트·베이스 빠짐, 필터 닫힘, 판 잡음 위 EP 아르페지오(Bbmaj7–Am7–Gm9–A7sus4)"),
    dict(n="A · 다시", bars=16, p="A", on="pad keys bass drum3 lead counter", th="A", li="vibe", filt=4000,
         vin=0.2, part="전", desc="비트 복귀, 비브라폰이 주제 A, 플루트 대선율"),
    dict(n="B · 끝", bars=12, p="B", on="pad keys bass drum3 lead arp", th="B", filt=4400, vin=0.25, part="전",
         desc="클라이맥스: 주제 B + 아르페지오 + 가장 밝은 필터, 마지막 마디 스네어 필"),
    dict(n="아웃트로", bars=13, p="A", on="pad keys drum1", filt=1400, vin=0.55, endSec=True, part="결",
         desc="킥 1·3박과 림만 6마디, 이후 패드·EP만 남고 필터가 천천히 닫혀 Dm9로 귀결"),
]
BARS = sum(s["bars"] for s in SECS)          # 105
DUR = BARS * BAR                              # 300.000 s
N = int(round(DUR * SR))                      # 13,230,000
assert BARS == 105 and N == 13230000

MAP = []
_b = 0
for i, s in enumerate(SECS):
    s["i"] = i
    s["start"] = _b
    o = {}
    for w in s["on"].split():
        if w.startswith("drum"):
            o["drum"] = int(w[4:])
        else:
            o[w] = True
    s["onf"] = o
    for bl in range(s["bars"]):
        MAP.append((i, bl))
    _b += s["bars"]

# ───────────────────────── 원곡 RNG(mulberry32 + FNV-1a) ─────────────────────────

M32 = 0xFFFFFFFF


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
    for ch in s:
        h ^= ord(ch)
        h = imul(h, 16777619)
    return h


def rng_of(*k):
    return mulberry(hash_str("|".join(str(x) for x in k)))


def pick(r, a):
    return a[int(r() * len(a))]


# ───────────────────────── 화음·음계(원곡 그대로) ─────────────────────────

QUAL = {'': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10],
        'm9': [0, 3, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14], '9': [0, 4, 7, 10, 14], '6': [0, 4, 7, 9],
        'm6': [0, 3, 7, 9], 'm7b5': [0, 3, 6, 10], '7b9': [0, 4, 7, 10, 13], '7sus4': [0, 5, 7, 10],
        'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '13': [0, 4, 7, 10, 14, 21], 'dim7': [0, 3, 6, 9],
        'add9': [0, 4, 7, 14]}
DORIAN = [0, 2, 3, 5, 7, 9, 10]
KEY = 62
NOTE_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def mod12(n):
    return n % 12


def pc_of(s):
    return mod12(NOTE_PC[s[0]] + (1 if s[1:2] == '#' else -1 if s[1:2] == 'b' else 0))


_CC = {}


def chord_p(name):
    if name in _CC:
        return _CC[name]
    main = name.split('/')[0]
    acc = 2 if main[1:2] in ('#', 'b') else 1
    iv = QUAL[main[acc:]]
    r = pc_of(main)
    ch = dict(name=name, r=r, iv=iv, pcs=[mod12(r + x) for x in iv], bass=r)
    _CC[name] = ch
    return ch


def chord_scale(key_pc, scale, ch):
    s = [mod12(key_pc + x) for x in scale]
    for pc in ch["pcs"]:
        if pc not in s:
            i = next((j for j, x in enumerate(s) if mod12(x - pc) == 1 or mod12(pc - x) == 1), -1)
            if i >= 0:
                s[i] = pc
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
    pri = [iv[k] for k in (1, 3, 4, 2, 5) if k < len(iv)]
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


def bar_chords(sec, bl):
    lst = PROGS[sec["p"]]
    names = lst[bl % len(lst)].split('-')
    return [dict(s=i * 16 / len(names), len=16 / len(names), ch=chord_p(nm)) for i, nm in enumerate(names)]


def half_at(halves, s):
    h = halves[0]
    for x in halves:
        if x["s"] <= s:
            h = x
    return h


# ───────────────────────── 주제 선율(makeMotif · realize) ─────────────────────────

def parse_rh(st):
    s = st.replace('|', '')
    out = []
    for i, c in enumerate(s):
        if c == 'x':
            l = 1
            while i + l < len(s) and s[i + l] == '-':
                l += 1
            out.append((i, l))
    return out


def make_motif(r):
    rh = parse_rh(pick(r, RH))
    return [dict(s=s, l=l, mv=0 if i == 0 else pick(r, [1, 1, 2, -1, 3, 0, 1] if i < len(rh) / 2
                                                    else [-1, -1, -2, 1, -3, 0, -1]))
            for i, (s, l) in enumerate(rh)]


_TH = {}


def theme(th):
    if th not in _TH:
        _TH[th] = dict(m1=make_motif(rng_of('deep', th, 1)), m2=make_motif(rng_of('deep', th, 2)))
    return _TH[th]


def realize(sec, th, chunk, lo, hi, center):
    T = theme(th)
    k = chunk % 4
    mot = T["m1"] if k in (0, 2) else T["m2"]
    b0 = bar_chords(sec, chunk * 2)
    b1 = bar_chords(sec, chunk * 2 + 1) if chunk * 2 + 1 < sec["bars"] else b0

    def ch_at(s):
        return (half_at(b0, s) if s < 16 else half_at(b1, s - 16))["ch"]
    key_pc = mod12(KEY)
    vr = rng_of('deep', th, 'v', k)
    cur = nearest_pc(center + (2 if k == 2 else 0), ch_at(0)["pcs"])
    out = []
    for i, n in enumerate(mot):
        ch = ch_at(n["s"])
        pcs = chord_scale(key_pc, DORIAN, ch)
        mv = n["mv"]
        if k == 2 and i >= len(mot) - 3:
            mv = pick(vr, [-1, 1, 2, -2])
        if i > 0:
            cur = step_in(cur, mv, pcs)
        if n["s"] % 8 == 0 or n["l"] >= 6:
            cur = nearest_pc(cur, ch["pcs"])
        while cur > hi:
            cur -= 12
        while cur < lo:
            cur += 12
        out.append(dict(s=n["s"], l=min(n["l"], 32 - n["s"]), m=cur))
    if k == 3 and out:
        last = out[-1]
        ch = ch_at(last["s"])
        last["m"] = nearest_pc(last["m"], [ch["r"], ch["pcs"][1]])
        last["l"] = max(last["l"], min(12, 32 - last["s"]))
    return out


def theme_notes(sec, bl, th):
    notes = realize(sec, th, bl >> 1, 67, 82, 74)
    off = (bl & 1) * 16
    return [dict(s=n["s"] - off, l=n["l"], m=n["m"]) for n in notes if off <= n["s"] < off + 16]


# ───────────────────────── genDeep → 사건 목록 ─────────────────────────

def gen_deep(bi, st):
    si, bl = MAP[bi]
    sec = SECS[si]
    on = sec["onf"]
    halves = bar_chords(sec, bl)
    nxt = None
    if bi + 1 < BARS:
        sj, bj = MAP[bi + 1]
        nxt = bar_chords(SECS[sj], bj)[0]["ch"]
    last = bl == sec["bars"] - 1
    end = bool(sec.get("endSec")) and last
    r = rng_of('deep', 'bar', bi)
    ev = []

    def E(s, ins, m, l, v):
        ev.append(dict(s=s, ins=ins, m=m, l=l, v=v))

    if end:
        h = halves[0]
        for m in voicing(h["ch"], 57, 3, True):
            E(0, 'pad', m, 28, 0.04)
        for i, m in enumerate(voicing(h["ch"], 64, 4, True)):
            E(i * 0.25, 'ep', m, 24, 0.05)
        E(0, 'sub', bass_note(h["ch"]["bass"], 36), 20, 0.16)
    else:
        if on.get("pad"):
            for h in halves:
                for m in voicing(h["ch"], 57, 3, True):
                    E(h["s"], 'pad', m, h["len"], 0.036)
        if on.get("keys"):
            KP = [[[0, 8], [10, 5]], [[0, 14]], [[0, 6], [6, 2], [11, 4]], [[2, 6], [10, 5]], [[0, 4], [7, 8]]]
            pat = [[0, 14]] if sec["n"] == '인트로' else KP[int(rng_of('deep', 'kp', bi >> 1)() * len(KP))]
            for s, l in pat:
                ch = half_at(halves, s)["ch"]
                for i, m in enumerate(voicing(ch, 64, 4, True)):
                    E(s + i * 0.15, 'ep', m, l, 0.05 if s == 0 else 0.04)
        if on.get("bass"):
            for h in halves:
                root = bass_note(h["ch"]["bass"], 36)
                E(h["s"], 'sub', root, min(h["len"] - 1, 6), 0.2)
                if h["len"] == 16 and r() < 0.65:
                    E(pick(r, [7, 10]), 'sub', root + pick(r, [7, 12, 0]), 3, 0.13)
            if nxt and r() < 0.45 and nxt["r"] != halves[-1]["ch"]["r"]:
                E(14, 'sub', bass_note(nxt["bass"], 36) + pick(r, [-1, 1, 2]), 2, 0.11)
        lv = on.get("drum", 0)
        hats_only = sec["n"] == '인트로' and bl >= 4
        if sec["n"] == '아웃트로':
            lv = 1 if bl < 6 else 0
        fill = lv >= 2 and last and not sec.get("endSec")
        if lv >= 1:
            kp = 'x.........x.....' if lv == 1 else \
                ['x......x..x.....', 'x.........x..x..', 'x......x.x......', 'x..x......x.....'][
                    int(rng_of('deep', 'kk', bi >> 2)() * 4)]
            for s in range(16):
                if kp[s] == 'x' and not (fill and s >= 8):
                    E(s, 'lkick', 0, 1, 0.34)
            if lv >= 2:
                E(4, 'lsnare', 0, 1, 0.15)
                if not fill:
                    E(12, 'lsnare', 0, 1, 0.15)
                    if r() < 0.2:
                        E(15, 'lsnare', 0, 1, 0.045)
            else:
                E(12, 'rim', 0, 1, 0.07)
            if fill:
                for i, s in enumerate([10, 12, 13, 14, 15]):
                    E(s, 'lsnare', 0, 1, 0.05 + i * 0.025)
        if lv >= 1 or hats_only:
            ohat = lv >= 3 and bl % 4 == 3
            for s in range(0, 16, 2):
                if not (ohat and s == 14):
                    E(s, 'hat', 0, 1, (0.05 if s % 4 == 0 else 0.034) * (0.7 if hats_only else 1))
            if lv >= 3:
                for s in range(1, 16, 2):
                    if r() < 0.35:
                        E(s, 'hat', 0, 1, 0.02)
            if ohat:
                E(14, 'ohat', 0, 1, 0.035)
        if on.get("lead"):
            for n in theme_notes(sec, bl, sec["th"]):
                E(n["s"], sec.get("li", 'epLead'), n["m"], n["l"], 0.07)
        if on.get("counter"):
            st.setdefault("cnt", 65)
            for h in halves:
                pcs = h["ch"]["pcs"]
                m = nearest_pc(st["cnt"] + (-1 if r() < 0.5 else 1), [pcs[1], pcs[3] if len(pcs) > 3 else pcs[2]])
                st["cnt"] = max(60, min(70, m))
                E(h["s"] + 1, 'flute', st["cnt"], h["len"] - 2, 0.028)
        if on.get("arp"):
            for h in halves:
                tones = voicing(h["ch"], 67, 4, False)
                seq = tones + tones[1:-1][::-1]
                s = h["s"]
                while s < h["s"] + h["len"]:
                    m = seq[int((s - h["s"]) / 2) % len(seq)] + (12 if bl % 2 else 0)
                    if m > 81:                      # 날카로운 고음 방지(원곡 대비 추가)
                        m -= 12
                    E(s, 'ep', m, 3, 0.03)
                    s += 2
    # 스윙 + 사람 손 흔들림(원곡: ±4 ms)
    bar_t = bi * BAR
    for e in ev:
        whole = math.floor(e["s"])
        s = e["s"]
        if whole % 2:
            s += SWING
        if e["ins"] in ('hat', 'ohat') and whole % 4 == 2:
            s += HAT_SWING8
        e["t"] = bar_t + s * STEP + (r() - 0.5) * 0.008
        e["d"] = e["l"] * STEP
    return ev


def build_events():
    st = {}
    ev = []
    for bi in range(BARS):
        ev += gen_deep(bi, st)
    return ev


# ───────────────────────── 기본 유틸(compose.py 에서 복사) ─────────────────────────

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


def lpq(f, fc, q=0.7071):
    x = f / fc
    return 1.0 / np.sqrt((1 - x * x) ** 2 + (x / q) ** 2)


def hpq(f, fc, q=0.7071):
    x = f / fc
    return x * x / np.sqrt((1 - x * x) ** 2 + (x / q) ** 2)


def bpq(f, fc, q):
    x = f / fc
    return (x / q) / np.sqrt((1 - x * x) ** 2 + (x / q) ** 2)


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


# ───────────────────────── 악기(원곡 Web Audio 악기를 numpy로) ─────────────────────────

def web_env(dur, a, peak, tau, sus, rel):
    """adsr(): 0→peak 선형(a) → peak*sus 로 지수 접근(tau) → end 에서 0으로 지수(rel). stop = end + 5·rel."""
    end = max(dur, a + 0.01)
    n = int((end + rel * 5) * SR)
    t = np.arange(n) / SR
    e = np.where(t < a, peak * t / a, peak * sus + peak * (1 - sus) * np.exp(-(t - a) / tau))
    ie = int(end * SR)
    if ie < n:
        e[ie:] = e[ie - 1] * np.exp(-(t[ie:] - end) / rel)
    return t, e


_TRI = None


def tri_table():
    global _TRI
    if _TRI is None:
        ph = np.arange(4096) / 4096
        y = np.zeros(4096)
        for k in range(1, 16, 2):                     # 띠 제한 삼각파(홀수 배음 15차까지)
            y += ((-1) ** ((k - 1) // 2)) * np.sin(2 * np.pi * k * ph) / (k * k)
        _TRI = (y * 8 / np.pi ** 2).astype(np.float64)
    return _TRI


def tri(freq, t, ph0=0.0):
    tab = tri_table()
    idx = ((ph0 + freq * t) % 1.0 * 4096).astype(np.int64) % 4096
    return tab[idx]


def ins_pad(f, dur, v):
    t, e = web_env(dur, min(0.8, dur * 0.3), v, 2.0, 0.85, 0.35)
    a = tri(f * 2 ** (-8 / 1200), t, rng.random())
    b = tri(f * 2 ** (8 / 1200), t, rng.random())
    gl1, gr1 = pan_gains(-0.5)
    gl2, gr2 = pan_gains(0.5)
    return np.stack([(a * gl1 + b * gl2) * e, (a * gr1 + b * gr2) * e]).astype(F32)


def ins_ep(f, dur, v, pan):
    """레이어드 로즈: FM EP(원곡 ep) + 사인 몸통 레이어(따뜻한 2배음, 반대편 팬, +3센트)."""
    t, e = web_env(dur, 0.006, v, 0.9, 0.3, 0.12)
    dev = f * (0.22 + 1.38 * np.exp(-t / 0.22))
    ph = 2 * np.pi * np.cumsum(f + dev * np.sin(2 * np.pi * f * t)) / SR
    fm = np.sin(ph) * e
    t2, e2 = web_env(dur, 0.004, v * 0.55, 1.4, 0.15, 0.15)
    f2 = f * 2 ** (3 / 1200)
    body = np.sin(2 * np.pi * f2 * t2) + 0.22 * np.exp(-t2 / 0.35) * np.sin(4 * np.pi * f2 * t2)
    body = np.tanh(1.3 * body) / np.tanh(1.3) * e2
    n = max(len(fm), len(body))
    out = np.zeros((2, n))
    gl, gr = pan_gains(pan)
    out[0, :len(fm)] += fm * gl
    out[1, :len(fm)] += fm * gr
    gl, gr = pan_gains(-pan * 0.8)
    out[0, :len(body)] += body * gl
    out[1, :len(body)] += body * gr
    return out.astype(F32)


def ins_eplead(f, dur, v):
    t, e = web_env(dur, 0.005, v, 0.6, 0.45, 0.08)
    dev = f * (0.15 + 1.25 * np.exp(-t / 0.12))
    ph = 2 * np.pi * np.cumsum(f + dev * np.sin(2 * np.pi * 2 * f * t)) / SR
    return (np.sin(ph) * e).astype(F32)


def partials(f, dur, v, parts):
    lens = [min(dur + 0.3, tau * 5 + 0.02) for _, _, tau in parts]
    n = int(max(lens) * SR) + 1
    t = np.arange(n) / SR
    y = np.zeros(n)
    rel_t = max(dur, 0.05)
    for (k, vol, tau), L in zip(parts, lens):
        e = np.where(t < 0.004, t / 0.004, np.exp(-(t - 0.004) / tau)) * v * vol
        m = t > rel_t
        e[m] *= np.exp(-(t[m] - rel_t) / 0.05)
        e[t > L] = 0
        y += np.sin(2 * np.pi * f * k * t) * e
    return y.astype(F32)


def ins_vibe(f, dur, v):
    return partials(f, max(dur, 0.5), v, [(1, 1, 0.8), (4, 0.1, 0.07)])


def ins_flute(f, dur, v):
    t, e = web_env(dur, 0.09, v, 1.0, 0.9, 0.1)
    vib = 1 + 0.003 * np.clip((t - 0.3) / 0.5, 0, 1) * np.sin(2 * np.pi * 4.8 * t)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    return ((np.sin(ph) + 0.06 * np.sin(2 * ph)) * e).astype(F32)


def ins_sub(f, dur, v):
    """따뜻한 서브: 사인 + 0.18 삼각파(2배) + 약한 tanh 포화(작은 스피커용 배음)."""
    t, e = web_env(dur, 0.012, v, 0.5, 0.7, 0.05)
    y = np.sin(2 * np.pi * f * t) + 0.18 * tri(2 * f, t)
    y = np.tanh(1.6 * y) / np.tanh(1.6)
    return (y * e).astype(F32)


def ins_lkick(v):
    """둥근 킥: 105→42 Hz 지수 하강(원곡 lkick), 3 ms 어택, 0.12 s 감쇠, 약한 포화."""
    tau = 0.12
    n = int((tau * 5 + 0.02) * SR)
    t = np.arange(n) / SR
    tr = tau * 1.2
    f = np.where(t < tr, 105 * (42 / 105) ** (t / tr), 42.0)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.where(t < 0.003, t / 0.003, np.exp(-(t - 0.003) / tau))
    y = np.tanh(1.5 * np.sin(ph) * e) / np.tanh(1.5)
    y[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return (y * v).astype(F32)


def noise_hit(v, dur, mag_fn, a=0.002):
    n = int((a + dur * 1.7 + 0.02) * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / SR)
    x = np.fft.irfft(np.fft.rfft(x) * mag_fn(fr), n=n)
    x /= max(1e-9, np.sqrt((x ** 2).mean()))
    e = np.where(t < a, t / a, np.exp(-(t - a) / (dur / 3)))
    return (x * e * v * 0.5).astype(F32)


def ins_lsnare(v):
    return noise_hit(v, 0.18, lambda fr: bpq(fr, 1150, 0.6) * lpq(fr, 5000), a=0.004)


def ins_rim(v):
    return noise_hit(v, 0.03, lambda fr: bpq(fr, 1700, 4.0), a=0.002)


def ins_hat(v, dur=0.035):
    # 원곡은 7.5 kHz 하이패스. 날카로움을 줄이려 6.5 kHz 하이패스 + 9.5 kHz 로우패스, 어택 1.5 ms
    return noise_hit(v, dur, lambda fr: hpq(fr, 6500, 0.7) * lpq(fr, 9500, 0.7), a=0.0015)


# ───────────────────────── 이펙트(compose.py 에서 복사·조정) ─────────────────────────

def reverb_ir(length=3.2, rt60_lo=2.6, rt60_hi=1.0):
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


def echo_ir(delay_beats=0.75, fb=0.35, taps=7):
    d = delay_beats * BEAT
    n = int(d * (taps + 1) * SR) + 16
    ir = np.zeros((2, n))
    for k in range(1, taps + 1):
        i = int(k * d * SR)
        ir[(k + 1) % 2, i] = fb ** (k - 1) * 0.6
    fr = np.fft.rfftfreq(n, 1 / SR)
    ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * lp_mag(fr, 3000, 1), n=n, axis=1)
    return ir.astype(F32)


def sidechain(trig, depth):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    shape = (1 - np.exp(-t / 0.008)) * np.exp(-t / 0.18)
    h = np.zeros(N, dtype=F32)
    h[:n] = shape
    env = np.fft.irfft(np.fft.rfft(trig) * np.fft.rfft(h), n=N)
    return (1 - depth * np.clip(env, 0, 1)).astype(F32)


def section_curve(key, default, slow_end=6.0, fast=0.9):
    """섹션 머리에서 setTargetAtTime 으로 옮기는 값(필터·판 잡음)을 원형으로 두 바퀴 돌려 정상 상태로."""
    cr = 200                                  # 제어율 200 Hz
    nc = int(DUR * cr)
    tgt = np.zeros(nc)
    tau = np.zeros(nc)
    for s in SECS:
        i0 = int(round(tb(s["start"]) * cr))
        i1 = int(round(tb(s["start"] + s["bars"]) * cr))
        tgt[i0:i1] = s.get(key, default)
        tau[i0:i1] = slow_end if s.get("endSec") else fast
    a = 1 - np.exp(-1 / (cr * tau))
    y = np.empty(nc)
    v = tgt[-1]
    for _ in range(2):
        for i in range(nc):
            v += a[i] * (tgt[i] - v)
            y[i] = v
    tc = np.arange(nc) / cr
    return np.interp(np.arange(N) / SR, tc, y, period=DUR)


def tape_wobble(x):
    """테이프 워블: 원형 분수 지연(wow 0.37 Hz · 1.1 Hz + flutter 5.3 Hz), 주기는 300초 정수배."""
    f1, f2, f3 = loopf(0.37), loopf(1.1), loopf(5.3)
    out = np.empty_like(x)
    CH = 1 << 20
    for i0 in range(0, N, CH):
        i = np.arange(i0, min(N, i0 + CH), dtype=np.float64)
        t = i / SR
        d = 0.0015 + 0.0009 * np.sin(2 * np.pi * f1 * t) + 0.00025 * np.sin(2 * np.pi * f2 * t + 1.0) \
            + 0.00004 * np.sin(2 * np.pi * f3 * t + 2.0)
        p = i - d * SR
        k = np.floor(p).astype(np.int64)
        fr = (p - k).astype(F32)
        k0 = k % N
        k1 = (k + 1) % N
        out[:, i0:i0 + len(i)] = x[:, k0] * (1 - fr) + x[:, k1] * fr
    return out


def vinyl_bus(level_curve, ref_rms):
    f = freqs()
    hiss = rng.standard_normal((2, N), dtype=F32)
    hiss = fd_filter(hiss, lp_mag(f, 2500, 1) * hp_mag(f, 250, 1))
    hiss *= F32(1.0 / np.sqrt((hiss.astype(np.float64) ** 2).mean()))
    cr = np.zeros((2, N), dtype=F32)
    nclick = int(DUR * 5.5)
    pos = rng.integers(0, N, nclick)
    amp = np.clip(rng.lognormal(0.0, 0.5, nclick), 0, 2.5) * rng.choice([-1, 1], nclick)   # 큰 딱 소리 상한
    side = rng.random(nclick)
    cr[0, pos] += (amp * np.clip(1.4 - side, 0.3, 1)).astype(F32)
    cr[1, pos] += (amp * np.clip(0.4 + side, 0.3, 1)).astype(F32)
    cr = fd_filter(cr, hp_mag(f, 700, 1) * lp_mag(f, 4200, 2))     # 둥근 딱딱이(날카로운 고음 제거)
    cr *= F32(1.0 / np.sqrt((cr.astype(np.float64) ** 2).mean()))
    g = (level_curve / 0.2).astype(F32)[None, :]
    return (hiss * F32(0.005 * ref_rms) + cr * F32(0.007 * ref_rms)) * g


# ───────────────────────── 측정·마스터링(compose.py 에서 복사) ─────────────────────────

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

BUS_OF = {'pad': 'pad', 'ep': 'keys', 'epLead': 'lead', 'vibe': 'lead', 'flute': 'lead2', 'sub': 'bass',
          'lkick': 'drum', 'lsnare': 'drum', 'rim': 'drum', 'hat': 'perc', 'ohat': 'perc'}


def synth(e):
    ins, f, d, v = e["ins"], mtof(e["m"]), e["d"], e["v"]
    if ins == 'pad':
        return ins_pad(f, d, v), 0.0
    if ins == 'ep':
        return ins_ep(f, d, v, 0.35 * math.sin(e["m"] * 2.3)), 0.0
    if ins == 'epLead':
        return ins_eplead(f, d, v), -0.1
    if ins == 'vibe':
        return ins_vibe(f, d, v), -0.1
    if ins == 'flute':
        return ins_flute(f, d, v), 0.35
    if ins == 'sub':
        return ins_sub(f, d, v), 0.0
    if ins == 'lkick':
        return ins_lkick(v), 0.0
    if ins == 'lsnare':
        return ins_lsnare(v), 0.05
    if ins == 'rim':
        return ins_rim(v), -0.15
    if ins == 'hat':
        return ins_hat(v), 0.25
    if ins == 'ohat':
        return ins_hat(v, 0.2), 0.3
    raise ValueError(ins)


def render(events, log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()
    by_bus = {}
    for e in events:
        by_bus.setdefault(BUS_OF[e["ins"]], []).append(e)

    trig = np.zeros(N, dtype=F32)
    for e in by_bus.get('drum', []):
        if e["ins"] == 'lkick':
            trig[int(round(e["t"] * SR)) % N] += e["v"] / 0.34
    duck = {k: sidechain(trig, dp) for k, dp in (('pad', 0.25), ('keys', 0.18), ('bass', 0.30))}

    t = np.arange(N, dtype=np.float64) / SR
    trem_ph = 2 * np.pi * loopf(3.6) * t
    trem = np.stack([1 + 0.12 * np.sin(trem_ph), 1 - 0.12 * np.sin(trem_ph)]).astype(F32)
    del t, trem_ph

    dry = new_bus()
    rev = new_bus()
    echo = new_bus()
    REV = {'keys': 0.3, 'lead': 0.3, 'lead2': 0.3, 'pad': 0.3, 'drum': 0.04, 'perc': 0.1, 'bass': 0.0}
    for name in ('pad', 'keys', 'lead', 'lead2', 'bass', 'drum', 'perc'):
        bus = new_bus()
        for e in by_bus.get(name, []):
            sig, pan = synth(e)
            add(bus, e["t"], sig, pan)
        if name == 'pad':
            bus = fd_filter(bus, lpq(f, 1700, 1.0) * hp_mag(f, 60, 1))
        elif name == 'bass':
            bus = fd_filter(bus, lpq(f, 500, 1.0) * hp_mag(f, 30, 2))
        elif name == 'drum':
            bus = fd_filter(bus, hp_mag(f, 30, 2))
        elif name == 'keys':
            bus = fd_filter(bus, hp_mag(f, 90, 1) * lpq(f, 7000, 0.7))
            bus *= trem
        elif name in ('lead', 'lead2'):
            bus = fd_filter(bus, hp_mag(f, 150, 1) * lpq(f, 7000, 0.7))
        bus *= F32(MIXG[name] * BAL[name])
        if name in duck:
            bus *= duck[name][None, :]
        if name == "perc":
            post = bus          # 하이햇은 섹션 필터 뒤에 더한다(아래)
        else:
            dry += bus
        if REV[name]:
            rev += F32(REV[name]) * bus
        if name == 'lead':
            echo += F32(0.2) * bus
        elif name == 'lead2':
            echo += F32(0.1) * bus
        st(f"{name}: {len(by_bus.get(name, []))}음")
        del bus
    del duck, trem

    ec = circ_conv(echo.mean(axis=0), echo_ir())
    dry += F32(0.5) * ec
    rev += F32(0.3) * ec
    del ec, echo
    st("echo")

    # 섹션 필터(원곡 S.filter: Q 0.5 저역 통과, 섹션 머리에서 setTargetAtTime): 1000 Hz 와 4400 Hz 판본 사이를 로그 보간
    fc = section_curve("filt", 12000)
    w = np.clip(np.log(fc / 1000.0) / np.log(4.4), 0, 1).astype(F32)[None, :]
    del fc
    lo = fd_filter(dry, 1.0 / (1.0 + (f / 1000.0) ** 2))
    dry = fd_filter(dry, 1.0 / (1.0 + (f / 4400.0) ** 2))
    dry -= lo
    dry *= w
    dry += lo
    del lo
    # 하이햇: 섹션 필터를 거치면 7 kHz 대역이 거의 사라지므로 따로 9 kHz 저역 통과 후 필터 열림 정도로만 세기 조절
    post = fd_filter(post, lpq(f, 9000, 0.7))
    post *= (0.35 + 0.65 * w)
    dry += post
    del post, w
    st("section filter")

    wet = circ_conv(rev, reverb_ir())
    del rev
    wet = fd_filter(wet, hp_mag(f, 150, 1) * lpq(f, 2600, 0.7))
    dry += F32(0.55) * wet
    del wet
    st("reverb")

    dry = tape_wobble(dry)
    st("tape wobble")

    ref = float(np.sqrt((dry.astype(np.float64) ** 2).mean()))
    vin = section_curve("vin", 0.2, slow_end=1.2, fast=1.2)
    dry += vinyl_bus(vin, ref)
    del vin
    st("vinyl")

    mix = dry
    mix *= automation([(0, 0.55), (2, 1.0), (103, 1.0), (105, 0.55)])[None, :]
    mix = fd_filter(mix, hp_mag(f, 25, 2) * lpq(f, 12000, 0.7))

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
    st(f"master (limiter max GR {gr:.2f} dB)")
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


def mp3_frames(data):
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
        frames += 1
        i += 144 * br // sr + pad
    return frames, frames * 1152 / sr


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
    x64 = x.astype(np.float64)
    mono = x.mean(axis=0).astype(F32)
    P, fr, tfr = stft_power(mono)

    def centroid(t0, t1):
        m = (tfr >= t0) & (tfr < t1)
        p = P[m].astype(np.float64).sum(axis=0)
        return float((fr * p).sum() / p.sum())

    L.append(f"# {TITLE} — 5분 로파이 BGM 합성 보고\n")
    L.append(f"- 원곡: 이전 프로젝트 `music.js` TRACKS.deep(`genDeep`) — {BPM} BPM, 16분 스윙 {SWING}, D dorian")
    L.append(f"- 길이 {DUR:.3f}초 = {BARS}마디 × {BAR:.4f}초, 44.1kHz 스테레오, 시드 {SEED}(numpy) + 원곡 문자열 시드(mulberry32)")
    L.append(f"- 사건 {len(events):,}개, 합성·분석 소요 {wall:.1f}초, 리미터 최대 감쇠 {gr:.2f} dB\n")

    L.append("## 곡 구조\n")
    L.append("| 단계 | 구간 | 시간 | 마디 | 화성 | 내용 |")
    L.append("|---|---|---|---|---|---|")
    for s in SECS:
        t0, t1 = tb(s["start"]), tb(s["start"] + s["bars"])
        L.append(f"| {s['part']} | {s['n']} | {mmss(t0)}～{mmss(t1)} | {s['start']}～{s['start'] + s['bars'] - 1} | "
                 f"{s['p']} | {s['desc']} |")
    L.append("\n- 진행 A: Dm9–Gm9–Bbmaj7–A7sus4/A7 · B: Gm9–C9–Fmaj7–Bbmaj7–Em7b5–A7–Dm9–Dm9 · C: Bbmaj7–Am7–Gm9–A7sus4")
    L.append("- 원곡 대비 조정: B·끝 16→12마디, 아웃트로 9→13마디(결을 37초로), 필터 A·다시 4200→4000·B·끝 3800→4400(클라이맥스를 가장 밝게), "
             "하이햇 뒷 8분 스윙 추가, 아르페지오 MIDI 81 초과 음은 한 옥타브 내림, 하이햇 대역 6.5～9.5kHz로 제한")
    L.append("- 음색: 둥근 킥(105→42 Hz 사인 하강), 소프트 스네어(1.15kHz 넓은 대역 잡음), 레이어드 로즈(FM EP + 사인 몸통, 좌우 트레몰로 3.6Hz), "
             "삼각파 패드(±8센트), 서브 베이스(사인+삼각 2배음, 500Hz 저역 통과, 킥 사이드체인), EP 리드·비브라폰 주제, 플루트 대선율")
    L.append("- 질감: 바이닐(쉿 소리 + 둥근 딱딱이, 섹션별 세기 0.2～0.6), 테이프 워블(0.37·1.1Hz wow + 5.3Hz flutter), 합성 IR 리버브, 3/8박 핑퐁 에코(리드)\n")

    L.append("## 구간별 에너지·밝기\n")
    L.append("| 구간 | 시간 | RMS(dBFS) | 피크(dBFS) | LUFS(근사) | 스펙트럼 중심(Hz) |")
    L.append("|---|---|---|---|---|---|")
    for s in SECS:
        t0, t1 = tb(s["start"]), tb(s["start"] + s["bars"])
        seg = x64[:, int(t0 * SR):int(t1 * SR)]
        L.append(f"| {s['part']} · {s['n']} | {mmss(t0)}～{mmss(t1)} | {db(math.sqrt((seg ** 2).mean())):.2f} | "
                 f"{db(np.abs(seg).max()):.2f} | {loudness(seg):.2f} | {centroid(t0, t1):.0f} |")
    for part in ("기", "승", "전", "결"):
        ss = [s for s in SECS if s["part"] == part]
        t0, t1 = tb(ss[0]["start"]), tb(ss[-1]["start"] + ss[-1]["bars"])
        seg = x64[:, int(t0 * SR):int(t1 * SR)]
        L.append(f"| **{part}** | {mmss(t0)}～{mmss(t1)} | {db(math.sqrt((seg ** 2).mean())):.2f} | "
                 f"{db(np.abs(seg).max()):.2f} | {loudness(seg):.2f} | {centroid(t0, t1):.0f} |")
    total_lufs = loudness(x)
    total_pk = db(np.abs(x64).max())
    L.append(f"| **전체** | 0:00～5:00 | {db(math.sqrt((x64 ** 2).mean())):.2f} | {total_pk:.2f} | {total_lufs:.2f} | "
             f"{centroid(0, DUR + 1):.0f} |\n")

    L.append("## 15초 창 RMS 곡선\n")
    L.append("```")
    rms15 = []
    for wi in range(20):
        seg = x64[:, wi * 15 * SR:(wi + 1) * 15 * SR]
        r = db(math.sqrt((seg ** 2).mean()))
        rms15.append(r)
        sec = SECS[[i for i, (b0) in enumerate([s["start"] for s in SECS]) if tb(b0) <= wi * 15 + 7.5][-1]]
        L.append(f"{mmss(wi * 15)}  {sec['part']} {sec['n']:<8s} {r:7.2f}  " + "■" * max(0, int(round(r + 40))))
    L.append("```")
    L.append("(■ 1칸 = 1 dB, 기준 −40 dBFS)\n")

    a = x64[:, -int(0.05 * SR):]
    b = x64[:, :int(0.05 * SR)]
    jump = float(np.abs(x64[:, 0] - x64[:, -1]).max())
    typ = float(np.abs(np.diff(x64[:, :SR], axis=1)).max())
    a1 = x64[:, -SR:]
    b1 = x64[:, :SR]
    L.append("## 루프 이음매\n")
    L.append(f"- 끝 50ms RMS {db(math.sqrt((a ** 2).mean())):.2f} dBFS / 처음 50ms RMS {db(math.sqrt((b ** 2).mean())):.2f} dBFS")
    L.append(f"- 끝 1초 RMS {db(math.sqrt((a1 ** 2).mean())):.2f} dBFS / 처음 1초 RMS {db(math.sqrt((b1 ** 2).mean())):.2f} dBFS")
    L.append(f"- 경계 샘플 차(마지막→첫 샘플) {jump:.5f}, 처음 1초 안의 인접 샘플 차 최대 {typ:.5f}")
    L.append("- 원형 버퍼 합성: 마지막 마디의 Dm9 패드·EP·서브 꼬리가 첫 마디 Dm9 위로 감김. 트레몰로·워블 LFO는 300초 정수 주기, "
             "섹션 필터·판 잡음 곡선도 원형으로 정상 상태를 맞춤. MP3 인코더 지연(약 25ms)은 남음\n")

    L.append("## 검사\n")
    ok_len = abs(mp3info["secs"] - DUR) <= 0.5
    ok_sz = mp3info["size"] <= 8 * 1024 * 1024
    ok_pk = total_pk <= -1.0
    ok_lu = abs(total_lufs - TARGET_LUFS) <= 1.0
    L.append("| 항목 | 기준 | 값 | 결과 |")
    L.append("|---|---|---|---|")
    L.append(f"| 길이(MP3 프레임) | 300±0.5초 | {mp3info['secs']:.3f}초({mp3info['frames']}프레임) | {'통과' if ok_len else '실패'} |")
    L.append(f"| 크기 | 8MB 이하 | {mp3info['size']:,} bytes ({mp3info['size'] / 1048576:.2f} MB) | {'통과' if ok_sz else '실패'} |")
    L.append(f"| 샘플 피크(PCM) | ≤ −1 dBFS | {total_pk:.2f} dBFS(상한 {CEIL_DB}로 MP3 오버슈트 여유) | {'통과' if ok_pk else '실패'} |")
    L.append(f"| 통합 라우드니스 | −16±1 LUFS | {total_lufs:.2f} LUFS | {'통과' if ok_lu else '실패'} |")
    L.append(f"\n- MP3 {BITRATE}kbps CBR, sha256 `{mp3info['sha']}`")
    L.append(f"- PCM(int16) sha256 `{mp3info['pcm_sha']}`")
    L.append("- 피크·라우드니스는 인코딩 전 PCM 기준(이 PC에 MP3 디코더 없음)\n")
    L.append("![스펙트로그램](spectrogram.png)")
    with open(os.path.join(outdir, "report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

    # 스펙트로그램 + RMS(두 패널, 같은 시간축)
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
    ax1.set_title(f"{TITLE} — 스펙트로그램과 RMS ({BPM} BPM, {BARS}마디, 300초)", loc="left")
    hop1 = SR
    r1 = [db(math.sqrt((x64[:, i:i + hop1] ** 2).mean())) for i in range(0, N, hop1)]
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
    return ok_len and ok_sz and ok_pk and ok_lu, total_lufs, total_pk


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="'깊은 작업' 로파이 BGM 합성")
    ap.add_argument("--out", default="bgm-lofi.mp3", help="MP3 출력 경로(json·report·png 는 같은 폴더)")
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
    meta = {"title": TITLE, "mood": MOOD, "duration": int(round(DUR)), "bpm": BPM, "key": "D dorian",
            "sections": [{"name": s["n"], "part": s["part"], "start": round(tb(s["start"]), 3)} for s in SECS],
            "seed": SEED}
    with open(base + ".json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs = mp3_frames(mp3)
    info = dict(frames=frames, secs=secs, size=len(mp3), sha=hashlib.sha256(mp3).hexdigest(),
                pcm_sha=hashlib.sha256(pcm.tobytes()).hexdigest())
    del pcm
    ok, lu, pk = analyze(mix, outdir, info, gr, time.time() - t0, events)
    print(f"MP3: {out}  {len(mp3):,} bytes, {secs:.3f}초, LUFS {lu:.2f}, 피크 {pk:.2f} dBFS")
    print(f"  sha256 {info['sha']}")
    print(f"  총 소요 {time.time() - t0:.1f}초, 검사:", "통과" if ok else "실패")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
