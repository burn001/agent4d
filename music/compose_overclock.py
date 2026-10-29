#!/usr/bin/env python3
"""'오버클록' 작업 배경음악 결정적 합성기 (Flow 표현 · 활동 단계 3 매우 활발).

다크신스 드라이브 — 굴러가는 16분 옥타브 베이스, 4/4 킥, 2·4박 스네어, 톱니 리드 모티프, 디튠 패드, 16분 아르페지오.
강하고 빠르게 밀어붙이되 고음은 눌러 장시간 듣기 피로를 줄였다. 외부 샘플 없이 numpy 로 전부 합성(자체 작곡).
공용 유틸·마스터링·MP3 부분은 music/compose_drive.py 에서 복사했다.

구조: 140 BPM, 4/4, 175마디 = 300초, G minor. 화성 Gm7–Ebmaj7–Cm(add9)–D7 (2마디씩, D7 은 화성단음계 딸림).
  기  0:00～0:27  (마디   0～15)  패드·아르페지오(필터 닫힘)
  승  0:27～2:17  (마디  16～79)  킥·16분 베이스(16), 스네어(24), 하이햇(32), 리드 예고(48～63), 76～79 노이즈 상승
  전  2:17～4:07  (마디  80～143) 리드 모티프+클랩, 112～119 브레이크다운(킥·베이스 빠짐), 120～143 옥타브 겹친 리드, 밝기 최대
  결  4:07～5:00  (마디 144～174) 리드 빠짐 → 스네어·햇(156) → 킥(160) → 베이스(164) 차례로 빠지고 패드+아르페지오, D7 → 처음의 Gm7

루프: 300초 원형 버퍼, 처음과 끝은 같은 편성·밝기(0.2)·마스터 레벨.

사용법:
  python compose_overclock.py --out bgm-overclock.mp3 [--wav 미리듣기.wav]   (같은 폴더에 bgm-overclock.json, report-overclock.md)
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


ID = "overclock"
SEED = 4140
SR = 44100
BPM = 140
BEAT = 60.0 / BPM
ST = BEAT / 4
BAR = 4 * BEAT
BARS = 175
DUR = BARS * BAR
N = int(round(DUR * SR))
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
SECTIONS = [("기", 0), ("승", 16), ("전", 80), ("결", 144)]
TITLE = "오버클록"
TITLE_EN = "Overclock"
MOOD = "다크신스 드라이브 — 굴러가는 16분 옥타브 베이스, 4/4 킥, 2·4박 스네어, 톱니 리드 모티프, 디튠 패드, 16분 아르페지오, 강하고 빠른 구동(고음 억제)"
KEY_NAME = "G minor"
STAGE = 3
ENERGY = 0.92

HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(SEED)
F32 = np.float32

KICK = dict(f0=50.0, sweep=140.0, sweep_tau=0.025, decay=0.2, click=0.12, drive=2.0)
BASS_TAU = 0.09
ECHO_BEATS = 0.75
REVERB = (2.6, 2.0, 0.9)
REV_WET = 0.24

CHORDS = {
    "Gm7": dict(pad=[55, 58, 62, 65], root=43),
    "Ebmaj7": dict(pad=[51, 55, 58, 62], root=39),
    "Cm9": dict(pad=[55, 58, 60, 63], root=36),
    "D7": dict(pad=[54, 57, 60, 62], root=38),
}
PROG = ["Gm7", "Ebmaj7", "Cm9", "D7"]
CHORD_OF = lambda bar: PROG[(bar % 8) // 2]

LAYERS = {
    "kick": [(16, 111), (120, 159)], "bass": [(16, 111), (120, 163)], "snare": [(24, 111), (120, 155)],
    "hat": [(32, 111), (120, 155)], "hat16": [(80, 111), (120, 143)], "clap": [(80, 111), (120, 143)],
    "lead": [(48, 63), (80, 111), (120, 143)], "lead8": [(120, 143)], "riser": [(76, 76), (116, 116)],
}
BRIGHT = [(0, 0.2), (16, 0.3), (48, 0.45), (80, 0.75), (108, 0.85), (112, 0.45), (120, 0.9), (144, 0.6), (160, 0.35), (175, 0.2)]
MASTER = [(0, 0.95), (2, 1.0), (172, 1.0), (175, 0.95)]

BUSES = {
    "kick": dict(ins={"kick"}, hp=30, lp=(2600, 4200), gain=0.45),
    "sub": dict(ins={"sub"}, hp=30, lp=(260, 380), gain=0.2, duck=0.7),
    "bass": dict(ins={"bass"}, hp=40, lp=(600, 1500), gain=0.32, duck=0.6),
    "pad": dict(ins={"pad"}, hp=150, lp=(700, 2600), gain=0.3, rev=0.4, duck=0.35),
    "arp": dict(ins={"pluck"}, hp=250, lp=(1200, 4200), gain=0.4, echo=0.3, rev=0.15, duck=0.3),
    "snare": dict(ins={"snare", "clap"}, hp=160, lp=(3200, 4800), gain=0.7, rev=0.35),
    "hat": dict(ins={"hat"}, hp=5200, lp=(7000, 9000), gain=0.5),
    "lead": dict(ins={"lead"}, hp=220, lp=(1600, 3400), gain=0.2, rev=0.35, echo=0.3, duck=0.2),
    "riser": dict(ins={"riser"}, hp=600, lp=(2500, 5500), gain=0.45, rev=0.3),
}

ROLL = [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 12, 7, 12]
ARP = [0, 1, 2, 3, 4, 3, 2, 1]
# 8마디 모티프 (마디 오프셋, 박, MIDI, 길이 박) — Gm7 · Ebmaj7 · Cm9 · D7
MOTIF = [(0, 0, 67, 1.5), (0, 1.5, 70, 1.5), (0, 3, 74, 1), (1, 0, 72, 3), (1, 3, 70, 1),
         (2, 0, 70, 1.5), (2, 1.5, 67, 1.5), (2, 3, 65, 1), (3, 0, 67, 4),
         (4, 0, 67, 1.5), (4, 1.5, 70, 1.5), (4, 3, 72, 1), (5, 0, 75, 3), (5, 3, 74, 1),
         (6, 0, 72, 1.5), (6, 1.5, 70, 1.5), (6, 3, 69, 1), (7, 0, 66, 4)]


def tb(bar: float, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


def build_events():
    E = []
    R = np.random.default_rng(SEED + 1)
    for bar in range(BARS):
        c = chord_at(bar)
        if bar % 2 == 0:
            for i, m in enumerate(c["pad"]):
                ev(E, "pad", tb(bar), m, 2 * BAR - 0.04, 0.5, -0.3 + 0.2 * i)
        tones = sorted(c["pad"])
        pool = tones + [tones[0] + 12]
        for s in range(16):
            m = pool[ARP[s % 8]] + 12
            v = (0.55 if s % 4 == 0 else 0.3) * (0.9 + 0.2 * R.random())
            ev(E, "pluck", tb(bar, s / 4), m, ST * 0.75, v, 0.3 if s % 2 else -0.3)
        if active("kick", bar):
            for b in range(4):
                ev(E, "kick", tb(bar, b), 0, 0.3, 0.9)
        if active("bass", bar):
            for s in range(16):
                m = c["root"] + ROLL[s]
                ev(E, "bass", tb(bar, s / 4), m, ST * 0.85, (0.9 if s % 4 == 0 else 0.7) * (0.95 + 0.1 * R.random()))
                if s % 4 == 0:
                    ev(E, "sub", tb(bar, s / 4), c["root"] - 12 if c["root"] > 40 else c["root"], BEAT * 0.9, 0.8)
        if active("snare", bar):
            for b in (1, 3):
                ev(E, "snare", tb(bar, b), bar % 3, 0.3, 0.85)
            if bar % 8 == 7:
                for s in (13, 14, 15):
                    ev(E, "snare", tb(bar, s / 4), 3, 0.2, 0.35 + 0.1 * (s - 13))
        if active("clap", bar):
            for b in (1, 3):
                ev(E, "clap", tb(bar, b), bar % 2, 0.3, 0.55, 0.1)
        if active("hat", bar):
            for s in range(2, 16, 4):
                ev(E, "hat", tb(bar, s / 4), 10 + (s // 4) % 2, 0.2, 0.5, 0.25)
        if active("hat16", bar):
            for s in range(16):
                if s % 4 != 2:
                    ev(E, "hat", tb(bar, s / 4), s % 4, 0.05, [0.32, 0.16, 0, 0.2][s % 4] * (0.8 + 0.4 * R.random()), -0.2)
        if active("lead", bar) and bar % 8 == 0:
            quiet = bar < 80
            for bo, bt, m, dl in MOTIF:
                ev(E, "lead", tb(bar + bo, bt), m - (12 if quiet else 0), dl * BEAT - 0.03, 0.45 if quiet else 0.8, 0.05)
                if active("lead8", bar):
                    ev(E, "lead", tb(bar + bo, bt), m - 12, dl * BEAT - 0.03, 0.55, -0.15)
        for a, _ in LAYERS["riser"]:
            if bar == a:
                ev(E, "riser", tb(bar), 0, 4 * BAR, 1.0)
    return E


# ───────── 공용 유틸·이펙트·마스터링·MP3 (music/compose_drive.py 에서 복사) ─────────

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



# ───────────────────────── 악기 (이 곡 묶음 공용 · Flow 코딩 BGM) ─────────────────────────

def _t(n):
    return np.arange(n, dtype=np.float64) / SR


def gate_env(n, dur, att, rel):
    """선형 어택 → 지속 → dur 이후 지수 릴리스, 끝 6ms 페이드."""
    t = _t(n)
    e = np.minimum(1.0, t / max(att, 1e-4))
    e = np.where(t < dur, e, e * np.exp(-(t - dur) / max(rel / 4.0, 1e-3)))
    k = min(n, int(0.006 * SR))
    e[-k:] *= np.linspace(1, 0, k)
    return e


def harm_pluck(f, dur, rel=0.12, tau0=0.6, tau_h=0.28, slope=0.45, square=0.0, fmax=6000.0):
    """배음 합 플럭: 높은 배음일수록 빨리 사라져 필터 엔벨로프 같은 소리(날카로움 억제)."""
    n = int((dur + rel) * SR)
    t = _t(n)
    y = np.zeros(n)
    kmax = max(1, min(28, int(fmax / f)))
    for k in range(1, kmax + 1):
        a = 1.0 / k
        if k % 2 == 0:
            a *= (1.0 - square)
        tau = tau0 if k == 1 else tau_h / (1.0 + slope * (k - 2))
        y += a * np.sin(2 * np.pi * k * f * t + 0.3 * k) * np.exp(-t / tau)
    return y * gate_env(n, dur, 0.003, rel)


def ins_kick(m, d, v):
    p = KICK
    n = int(0.55 * SR)
    t = _t(n)
    fr = p["f0"] + p["sweep"] * np.exp(-t / p["sweep_tau"])
    y = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / p["decay"]) * (1 - np.exp(-t / 0.0015))
    y += p["click"] * np.sin(2 * np.pi * 1400 * t) * np.exp(-t / 0.004)
    y = np.tanh(p["drive"] * y) / math.tanh(p["drive"])
    return y


def _noise(key, n):
    return np.random.default_rng(SEED * 100 + key).standard_normal(n)


def ins_hat(m, d, v):
    """m: 0～3 닫힘 변형, 10～11 열림."""
    op = m >= 10
    n = int((0.32 if op else 0.07) * SR)
    t = _t(n)
    return _noise(int(m) + 1, n) * np.exp(-t / (0.085 if op else 0.016)) * (1 - np.exp(-t / 0.0008))


def ins_clap(m, d, v):
    n = int(0.35 * SR)
    t = _t(n)
    env = np.zeros(n)
    for k, off in enumerate((0.0, 0.011, 0.022)):
        i = int(off * SR)
        env[i:] += (0.8 ** k) * np.exp(-(t[: n - i]) / 0.006)
    i = int(0.03 * SR)
    env[i:] += 0.7 * np.exp(-t[: n - i] / 0.11)
    return _noise(40 + int(m), n) * env


def ins_snare(m, d, v):
    n = int(0.4 * SR)
    t = _t(n)
    tone = np.sin(2 * np.pi * (175 + 40 * np.exp(-t / 0.01)) * t) * np.exp(-t / 0.07)
    nz = _noise(60 + int(m), n) * np.exp(-t / 0.13) * (1 - np.exp(-t / 0.001))
    return 0.75 * tone + 0.55 * nz


def ins_rim(m, d, v):
    n = int(0.12 * SR)
    t = _t(n)
    return (np.sin(2 * np.pi * 1650 * t) * np.exp(-t / 0.011) + 0.6 * np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.02)
            + 0.25 * _noise(80, n) * np.exp(-t / 0.003))


def ins_sub(m, d, v):
    f = mtof(m)
    n = int((d + 0.05) * SR)
    t = _t(n)
    y = np.sin(2 * np.pi * f * t) + 0.12 * np.sin(4 * np.pi * f * t)
    return y * gate_env(n, d, 0.004, 0.05)


def ins_bass(m, d, v):
    f = mtof(m)
    y = harm_pluck(f, d, rel=0.04, tau0=4.0, tau_h=BASS_TAU, slope=0.35, square=0.0, fmax=2400.0)
    n = len(y)
    y += 0.6 * np.sin(2 * np.pi * f * _t(n)) * gate_env(n, d, 0.003, 0.04)
    return y


def ins_pluck(m, d, v):
    return harm_pluck(mtof(m), d, rel=0.18, tau0=0.45, tau_h=0.16, slope=0.5, square=0.35, fmax=5000.0)


def ins_bell(m, d, v):
    f = mtof(m)
    n = int((d + 1.6) * SR)
    t = _t(n)
    idx = 1.2 * np.exp(-t / 0.25)
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * 3.5 * f * t)) * np.exp(-t / 1.1)
    return y * gate_env(n, d + 1.4, 0.002, 0.2)


def saw_var(freq, phase0=0.0):
    """주파수가 시간에 따라 변하는 polyBLEP 톱니(비브라토용)."""
    dt = freq / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    y = 2.0 * ph - 1.0
    m1 = ph < dt
    t = ph[m1] / dt[m1]
    y[m1] -= t + t - t * t - 1.0
    m2 = ph > 1.0 - dt
    t = (ph[m2] - 1.0) / dt[m2]
    y[m2] -= t * t + t + t + 1.0
    return y


def ins_lead(m, d, v):
    f = mtof(m)
    rel = 0.18
    n = int((d + rel) * SR)
    t = _t(n)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.0 * t) * np.clip((t - 0.25) / 0.4, 0, 1)
    y = 0.6 * saw_var(f * vib * 1.003) + 0.6 * saw_var(f * vib * 0.997, 0.37)
    y += 0.5 * np.sin(2 * np.pi * f * t)
    return y * gate_env(n, d, 0.012, rel)


def ins_pad(m, d, v):
    """스테레오 디튠 톱니 3겹/채널."""
    f = mtof(m)
    rel = 1.4
    n = int((d + rel) * SR)
    env = gate_env(n, d, 0.6, rel)
    out = np.zeros((2, n))
    for ch in range(2):
        for k, c in enumerate((-9, 0, 8)):
            det = c + (3 if ch else -3)
            out[ch] += polyblep_saw(f * 2 ** (det / 1200), n, 0.13 * k + 0.41 * ch)
    return out * env[None, :] / 3.0


def ins_riser(m, d, v):
    n = int(d * SR)
    t = _t(n)
    return _noise(90 + int(m), n) * (t / d) ** 2.5 * gate_env(n, d - 0.01, 0.01, 0.01)


INS = {"kick": ins_kick, "hat": ins_hat, "clap": ins_clap, "snare": ins_snare, "rim": ins_rim, "sub": ins_sub,
       "bass": ins_bass, "pluck": ins_pluck, "bell": ins_bell, "lead": ins_lead, "pad": ins_pad, "riser": ins_riser}
_SYN = {}


def synth(e):
    key = (e["ins"], e["m"], round(e["d"], 4))
    if key not in _SYN:
        _SYN[key] = INS[e["ins"]](e["m"], e["d"], e["v"]).astype(F32)
    return _SYN[key]


def ev(events, ins, t, m=0, d=0.1, v=1.0, pan=0.0):
    events.append(dict(ins=ins, t=float(t), m=m, d=float(d), v=float(v), pan=float(pan)))


def chord_at(bar):
    return CHORDS[CHORD_OF(bar)]


def active(name, bar):
    return any(a <= bar <= b for a, b in LAYERS.get(name, []))


# ───────────────────────── 렌더 ─────────────────────────

def render(log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()
    events = build_events()
    st(f"events {len(events)}")
    bright = automation(BRIGHT)
    mix = new_bus()
    rev_send = new_bus()
    echo_send = new_bus()
    trig = np.zeros(N, dtype=F32)
    for e in events:
        if e["ins"] == "kick":
            trig[int(round(e["t"] * SR)) % N] += e["v"]
    duck = sidechain(trig, 1.0)
    stems = {}
    for name, spec in BUSES.items():
        evs = [e for e in events if e["ins"] in spec["ins"]]
        if not evs:
            continue
        bus = new_bus()
        for e in evs:
            add(bus, e["t"], synth(e) * F32(e["v"]), e["pan"])
        _SYN.clear()
        hp = hp_mag(f, spec.get("hp", 20), 2)
        dark = hp * lp_mag(f, spec["lp"][0], spec.get("ord", 2))
        brt = hp * lp_mag(f, spec["lp"][1], spec.get("ord", 2))
        bus = fd_split(bus, dark, brt, bright)
        if spec.get("duck"):
            bus *= (1 - spec["duck"] + spec["duck"] * duck)[None, :]
        bus *= F32(spec["gain"])
        stems[name] = sec_rms(bus)
        mix += bus
        if spec.get("rev"):
            rev_send += F32(spec["rev"]) * bus
        if spec.get("echo"):
            echo_send += F32(spec["echo"]) * bus
        del bus
        st(name)
    echo = circ_conv(echo_send.mean(axis=0), echo_ir(ECHO_BEATS, 0.34, 7))
    mix += 0.4 * echo
    rev_send += 0.3 * echo
    del echo, echo_send
    wet = circ_conv(rev_send, reverb_ir(*REVERB))
    wet = fd_filter(wet, hp_mag(f, 180, 1) * lp_mag(f, 6000, 1))
    mix += F32(REV_WET) * wet
    del wet, rev_send
    st("fx")
    mix *= automation(MASTER)[None, :]
    mix = fd_filter(mix, hp_mag(f, 28, 2) * lp_mag(f, 9500, 1))
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
    return mix, events, {k: [v + gdb for v in row] for k, row in stems.items()}, gr


def sec_rms(x):
    bounds = [b for _, b in SECTIONS] + [BARS]
    row = []
    for k in range(len(SECTIONS)):
        seg = x[:, int(tb(bounds[k]) * SR):int(tb(bounds[k + 1]) * SR)].astype(np.float64)
        row.append(20 * math.log10(max(math.sqrt(float((seg ** 2).mean())), 1e-12)))
    return row


def onset_rate(seg):
    """에너지 지표: 10ms RMS 포락선의 양(+)의 변화 합/초 — 타격 밀도·세기."""
    mono = seg.mean(axis=0).astype(np.float64)
    w = int(0.01 * SR)
    k = len(mono) // w
    r = np.sqrt((mono[: k * w].reshape(k, w) ** 2).mean(axis=1))
    rd = 20 * np.log10(r + 1e-6)
    return float(np.clip(np.diff(rd), 0, None).sum() / (k * 0.01))


def analyze(x, log=print):
    res = {"sections": [], "windows": []}
    bounds = [s for _, s in SECTIONS] + [BARS]
    log("\n  구간  시간          RMS     피크     LUFS    중심Hz  8k↑dB  타격밀도")
    for k, (name, b0) in enumerate(SECTIONS):
        t0, t1 = tb(b0), tb(bounds[k + 1])
        seg = x[:, int(t0 * SR):int(t1 * SR)]
        row = dict(name=name, t0=t0, t1=t1, rms=db(math.sqrt(float((seg.astype(np.float64) ** 2).mean()))),
                   peak=db(float(np.abs(seg).max())), lufs=loudness(seg), cent=centroid(seg), hf=hf_ratio(seg),
                   onset=onset_rate(seg))
        res["sections"].append(row)
        log(f"  {name}    {mmss(t0)}～{mmss(t1)}  {row['rms']:7.2f} {row['peak']:7.2f} {row['lufs']:7.2f} "
            f"{row['cent']:7.0f} {row['hf']:6.1f} {row['onset']:8.1f}")
    res["total_rms"] = db(math.sqrt(float((x.astype(np.float64) ** 2).mean())))
    res["peak"] = db(float(np.abs(x).max()))
    res["lufs"] = loudness(x)
    res["true_peak"] = db(true_peak(x))
    res["cent"] = centroid(x)
    res["hf"] = hf_ratio(x)
    res["onset"] = onset_rate(x)
    log(f"  전체  0:00～5:00    {res['total_rms']:7.2f} {res['peak']:7.2f} {res['lufs']:7.2f} {res['cent']:7.0f} "
        f"{res['hf']:6.1f} {res['onset']:8.1f}  (트루피크≈{res['true_peak']:.2f} dBTP)")
    for w in range(20):
        seg = x[:, w * 15 * SR:(w + 1) * 15 * SR]
        r = db(math.sqrt(float((seg.astype(np.float64) ** 2).mean())))
        res["windows"].append((w * 15, r, crest(seg)))
    log("  15초 RMS: " + " ".join(f"{r:.1f}" for _, r, _ in res["windows"]))
    a = x[:, -int(0.05 * SR):].astype(np.float64)
    b = x[:, :int(0.05 * SR)].astype(np.float64)
    jump = float(np.abs(x[:, 0].astype(np.float64) - x[:, -1].astype(np.float64)).max())
    typ = float(np.abs(np.diff(x[:, :SR].astype(np.float64), axis=1)).max())
    res["seam"] = dict(end50=db(math.sqrt((a ** 2).mean())), start50=db(math.sqrt((b ** 2).mean())), jump=jump, typ=typ,
                       end1s=db(math.sqrt((x[:, -SR:].astype(np.float64) ** 2).mean())),
                       start1s=db(math.sqrt((x[:, :SR].astype(np.float64) ** 2).mean())),
                       cent_end=centroid(x[:, -10 * SR:]), cent_start=centroid(x[:, :10 * SR]))
    s = res["seam"]
    log(f"  루프 이음매: 끝/처음 50ms RMS {s['end50']:.2f}/{s['start50']:.2f} dBFS, 1초 {s['end1s']:.2f}/{s['start1s']:.2f}, "
        f"경계 샘플 차 {jump:.5f} (인접 차 최대 {typ:.5f}), 중심 {s['cent_end']:.0f}/{s['cent_start']:.0f} Hz")
    return res


def write_report(path, res, stems, checks, files, pcm_sha, gr, elapsed):
    L = [f"# {TITLE} ({TITLE_EN}) — 합성 보고\n",
         f"- 생성: `compose_{ID}.py` (seed {SEED}, numpy {np.__version__}), 실행 {elapsed:.0f}초",
         f"- 형식: {SR} Hz 스테레오, {BITRATE} kbps CBR, {BPM} BPM 4/4, {BARS}마디 = {DUR:.1f}초, {KEY_NAME}",
         f"- 용도: Flow 표현 · 활동 단계 {STAGE}, energy {ENERGY}. {MOOD}\n",
         "## 구간별 지표\n", "| 구간 | 시간 | RMS | 피크 | LUFS | 중심(Hz) | 8k↑(dB) | 타격밀도 |", "|---|---|---|---|---|---|---|---|"]
    for r in res["sections"]:
        L.append(f"| {r['name']} | {mmss(r['t0'])}～{mmss(r['t1'])} | {r['rms']:.2f} | {r['peak']:.2f} | {r['lufs']:.2f} | "
                 f"{r['cent']:.0f} | {r['hf']:.1f} | {r['onset']:.1f} |")
    L.append(f"| 전체 | 0:00～5:00 | {res['total_rms']:.2f} | {res['peak']:.2f} | {res['lufs']:.2f} | {res['cent']:.0f} | "
             f"{res['hf']:.1f} | {res['onset']:.1f} |\n")
    L.append("갈래별 RMS(마스터 이득 적용, dBFS)\n")
    L.append("| 갈래 | " + " | ".join(n for n, _ in SECTIONS) + " |")
    L.append("|---|" + "---|" * len(SECTIONS))
    for k, row in stems.items():
        L.append(f"| {k} | " + " | ".join(("—" if v < -90 else f"{v:.1f}") for v in row) + " |")
    L.append("\n15초 창 RMS: " + ", ".join(f"{mmss(t)} {r:.1f}" for t, r, _ in res["windows"]) + "\n")
    s = res["seam"]
    L.append(f"루프 이음매: 끝/처음 50ms {s['end50']:.2f}/{s['start50']:.2f} dBFS, 1초 {s['end1s']:.2f}/{s['start1s']:.2f} dBFS, "
             f"경계 샘플 차 {s['jump']:.5f}(인접 차 최대 {s['typ']:.5f}), 중심 {s['cent_end']:.0f}/{s['cent_start']:.0f} Hz. "
             "300초 원형 버퍼에 합성해 꼬리·리버브·딜레이가 앞머리로 감김. MP3 인코더 지연(약 25～50ms)은 남음.\n")
    L.append("## 검사\n")
    L.append("| 항목 | 기준 | 결과 | 판정 |")
    L.append("|---|---|---|---|")
    for name, crit, val, ok in checks:
        L.append(f"| {name} | {crit} | {val} | {'통과' if ok else '실패'} |")
    L.append(f"\n리미터 최대 이득 감소 {gr:.2f} dB. PCM SHA-256 `{pcm_sha}`\n")
    for fn, size, h in files:
        L.append(f"- `{fn}` {size:,} bytes `{h}`")
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
    ap.add_argument("--out", default=os.path.join(HERE, f"bgm-{ID}.mp3"), help="MP3 출력 경로(json·report 는 같은 폴더)")
    ap.add_argument("--wav", default=None)
    args = ap.parse_args(argv)
    t0 = time.time()
    print(f"합성 시작: {ID} {BPM} BPM, {BARS}마디, {DUR:.0f}초, seed {SEED}")
    mix, events, stems, gr = render()
    res = analyze(mix)
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
    mp3 = encode_mp3(pcm)
    with open(out, "wb") as fh:
        fh.write(mp3)
    jpath = os.path.join(od, os.path.splitext(os.path.basename(out))[0] + ".json")
    meta = {"duration": int(round(DUR)), "bpm": BPM, "key": KEY_NAME,
            "sections": [{"name": n, "start": int(round(tb(b)))} for n, b in SECTIONS], "seed": SEED,
            "title": TITLE, "mood": MOOD, "stage": STAGE, "energy": ENERGY}
    with open(jpath, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs = mp3_frames(mp3)
    pcm_sha = hashlib.sha256(pcm.tobytes()).hexdigest()
    checks = [
        ("길이", "300±0.5초", f"{secs:.3f}초 ({frames} 프레임)", abs(secs - DUR) <= 0.5),
        ("크기", "8 MB 이하", f"{len(mp3)/1048576:.2f} MB", len(mp3) <= 8 * 1024 * 1024),
        ("샘플 피크", "≤ −1.5 dBFS", f"{res['peak']:.2f} dBFS", res["peak"] <= -1.5 + 1e-3),
        ("트루 피크(4× 근사)", "참고", f"{res['true_peak']:.2f} dBTP", True),
        ("통합 라우드니스", "−16±0.5 LUFS", f"{res['lufs']:.2f} LUFS", abs(res["lufs"] - TARGET_LUFS) <= 0.5),
        ("8kHz 이상 에너지", "≤ −25 dB(전체 대비)", f"{res['hf']:.1f} dB", res["hf"] <= -25.0),
        ("PCM 길이", "정확히 300초", f"{pcm.shape[1]} 샘플", pcm.shape[1] == N),
    ]
    ok = all(c[3] for c in checks)
    elapsed = time.time() - t0
    me = os.path.abspath(__file__)
    files = [(os.path.basename(out), len(mp3), hashlib.sha256(mp3).hexdigest()),
             (os.path.basename(jpath), os.path.getsize(jpath), sha(jpath)), (os.path.basename(me), os.path.getsize(me), sha(me))]
    write_report(os.path.join(od, f"report-{ID}.md"), res, stems, checks, files, pcm_sha, gr, elapsed)
    print(f"MP3 {out} {len(mp3):,} bytes, {secs:.3f}초")
    for c in checks:
        print(f"  {c[0]}: {c[2]} ({c[1]}) {'통과' if c[3] else '실패'}")
    print(f"  검사: {'통과' if ok else '실패'}  (실행 {elapsed:.0f}초)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
