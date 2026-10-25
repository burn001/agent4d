#!/usr/bin/env python3
"""'새벽 피아노' BGM 결정적 합성기 (활동 단계 0 · 한가).

자체 작곡. 성긴 펠트 피아노(해머 약하게, 긴 서스테인, 두 줄 맥놀이, 댐퍼 잡음 살짝), 따뜻한 삼각파 패드,
아주 옅은 테이프 히스. 리듬은 거의 없고 '고조' 구간에만 아주 작은 심장박동 서브 펄스와 셰이커.
마스터링·원형 버퍼 루프·검사·MP3 파이프라인은 music/compose_lofi.py 에서 복사해 재사용한다.

64 BPM 4/4 80마디 = 정확히 300초, F major(7·9화음).
  기  새벽(0～8) · 모티프(8～16)      피아노 단음 모티프, 아주 옅은 패드 → 왼손 저음 단음
  승  화음(16～28) · 흐름(28～40)     왼손 굴림 화음, 패드가 차오름, B 진행(Bbmaj7–Am7–Gm9–C7sus4)
  전  고조(40～56, 2:30～3:30)       모티프 변주(옥타브 위·경과음), 8분 분산화음, 심장박동 서브 펄스·셰이커, 패드 밝아짐
  결  잦아듦(56～68) · 귀결(68～80)   펄스 빠짐, 화음 성겨지고 단음 모티프로 귀결 → C9sus4 에서 처음 Fmaj9 로 이어짐

사용법:
  python compose_dawn.py --out bgm-dawn.mp3 [--wav 미리듣기.wav]
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
BPM = 64
BEAT = 60.0 / BPM              # 0.9375 s
BAR = 4 * BEAT                 # 3.75 s
TARGET_LUFS = -16.0
CEIL_DB = -1.5
BITRATE = 128
TITLE = "새벽 피아노"
MOOD = "한가 · 펠트 피아노 앰비언트, 조용히 생각하는 새벽"
KEY = "F major"
STAGE = 0
ENERGY = 0.15
WOBBLE = 0.45                  # 테이프 워블 깊이(로파이 곡 대비 비율, 피아노 음정이 흔들리지 않게 작게)

rng = np.random.default_rng(SEED)
F32 = np.float32

# ───────────────────────── 곡 데이터 ─────────────────────────

# 화음: (근음 pc, 패드/왼손 보이싱 MIDI)
CHORD = {
    "Fmaj9":     (5,  [57, 60, 64, 67]),     # A3 C4 E4 G4
    "Dm9":       (2,  [53, 57, 60, 64]),     # F3 A3 C4 E4
    "Bbmaj9":    (10, [57, 60, 62, 65]),     # A3 C4 D4 F4
    "C9sus4":    (0,  [58, 62, 65, 67]),     # Bb3 D4 F4 G4
    "Bbmaj7":    (10, [53, 57, 62, 65]),     # F3 A3 D4 F4
    "Am7":       (9,  [55, 60, 64, 67]),     # G3 C4 E4 G4
    "Gm9":       (7,  [53, 58, 62, 69]),     # F3 Bb3 D4 A4
    "C7sus4":    (0,  [55, 58, 60, 65]),     # G3 Bb3 C4 F4
    "Bbmaj7#11": (10, [57, 62, 64, 69]),     # A3 D4 E4 A4
}
PROG = {"A": "Fmaj9 Dm9 Bbmaj9 C9sus4".split(),
        "B": "Bbmaj7 Am7 Gm9 C7sus4".split(),
        "C1": "Dm9 Bbmaj7#11 Fmaj9 C9sus4".split(),
        "C2": "Dm9 Bbmaj9 Gm9 C9sus4".split(),
        "C3": "Bbmaj9 Am7 Dm9 Gm9".split(),
        "C4": "Bbmaj9 Am7 Bbmaj9 C9sus4".split()}

# 오른손 선율 틀: 마디마다 (박, MIDI, 세기 배율)
MEL = {
    "A0": [[(0, 72, .85), (2, 76, .9)], [(0.5, 74, .85), (2.5, 69, .8)],
           [(0, 72, .85), (2, 77, .9)], [(0, 74, .8), (2, 67, .75)]],
    "A":  [[(0, 72, 1.0), (1, 69, .85), (2, 76, .95)], [(0.5, 74, .9), (1.5, 72, .8), (2.5, 69, .85)],
           [(0, 72, .9), (1, 74, .85), (2, 77, 1.0), (3, 76, .8)], [(0, 74, .9), (2, 67, .8)]],
    "A2": [[(0, 72, 1.0), (1, 69, .85), (2, 79, .95), (3, 76, .8)], [(0.5, 77, .9), (1.5, 76, .85), (2.5, 74, .8)],
           [(0, 72, .9), (2, 69, .85)], [(0, 67, .85), (2, 65, .75)]],
    "A3": [[(0, 72, .9), (2, 69, .8)], [(1, 74, .8)], [(0, 72, .75), (2.5, 69, .7)], [(1, 67, .72), (2.5, 69, .6)]],
    "B":  [[(0, 77, .95), (1, 74, .8), (2, 69, .85)], [(0.5, 72, .85), (1.5, 76, .9), (3, 79, .95)],
           [(0, 77, .9), (1, 74, .8), (2.5, 69, .8)], [(0, 70, .85), (2, 72, .8)]],
}
# 전(고조) 변주: (원 선율, 화음 진행, 옥타브 올릴 마디, 경과음 넣기)
VAR = {"C1": ("A2", (), False), "C2": ("B", (), True), "C3": ("A", (0, 1, 2, 3), True), "C4": ("A2", (0, 1), True)}

SECS = [
    dict(n="새벽", bars=8, part="기", phr="A0 A", lh="none", pv=(0.40, 0.42), pad=0.22, br=0.0,
         desc="피아노 단음 모티프만, 아주 옅은 Fmaj9 패드와 테이프 히스"),
    dict(n="모티프", bars=8, part="기", phr="A A2", lh="root", pv=(0.42, 0.45), pad=0.40, br=0.12,
         desc="모티프 반복·답구, 왼손 저음 단음이 들어옴"),
    dict(n="화음", bars=12, part="승", phr="A B A2", lh="roll", pv=(0.46, 0.49), pad=0.75, br=0.35,
         desc="왼손 굴림 화음(7·9화음), 패드가 차오름, B 진행 첫 등장"),
    dict(n="흐름", bars=12, part="승", phr="B A B", lh="roll2", pv=(0.49, 0.51), pad=0.85, br=0.45,
         desc="화음 사이 약한 뒷박 화음, 대답 선율, C7sus4 에서 Dm9 로 기만 진행"),
    dict(n="고조", bars=16, part="전", phr="C1 C2 C3 C4", lh="arp", pv=(0.50, 0.60), pad=1.0, br=1.0,
         desc="모티프 변주(옥타브 위·경과음), 8분 분산화음, 42마디부터 심장박동 서브 펄스·셰이커, 50마디 정점"),
    dict(n="잦아듦", bars=12, part="결", phr="A B A2", lh="roll", pv=(0.47, 0.43), pad=0.6, br=0.35,
         desc="펄스·셰이커 빠짐, 굴림 화음이 성겨짐"),
    dict(n="귀결", bars=12, part="결", phr="A2 A0 A3", lh="root6", pv=(0.42, 0.39), pad=0.32, br=0.05,
         desc="왼손 저음 6마디 뒤 빠지고 단음 모티프 조각으로 귀결, C9sus4 에서 첫 마디 Fmaj9 로 감김"),
]
BARS = sum(s["bars"] for s in SECS)          # 80
DUR = BARS * BAR                              # 300.000 s
N = int(round(DUR * SR))                      # 13,230,000
assert BARS == 80 and N == 13230000

_b = 0
for _i, _s in enumerate(SECS):
    _s["i"] = _i
    _s["start"] = _b
    _s["p"] = " / ".join(_s["phr"].split())
    _b += _s["bars"]

SCALE_PC = [5, 7, 9, 10, 0, 2, 4]           # F major

# ───────────────────────── 재사용 유틸·마스터링(compose_lofi.py 에서 그대로 복사) ─────────────────────────

_FREQ = None
_TRI = None

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


# ───────────────────────── 악보 생성 ─────────────────────────

def pcs_of(name):
    r, v = CHORD[name]
    return {r} | {m % 12 for m in v}


def snap(m, pcs):
    for d in range(7):
        for s in (m - d, m + d):
            if s % 12 in pcs:
                return s
    return m


def scale_step(m, d):
    s = m + d
    while s % 12 not in SCALE_PC:
        s += d
    return s


def low_root(pc, lo=36):
    return lo + (pc - lo) % 12


def phrase_melody(name, chords):
    """(마디 안 박 위치 합산, MIDI, 세기 배율) 목록. 고조 구간은 원 선율을 화음에 맞춰 변주한다."""
    if name not in VAR:
        return [(bi * 4 + bt, m, vm) for bi, bar in enumerate(MEL[name]) for bt, m, vm in bar]
    src, up, passing = VAR[name]
    notes = []
    for bi, bar in enumerate(MEL[src]):
        pcs = pcs_of(chords[bi])
        for bt, m, vm in bar:
            m2 = snap(m, pcs)
            if bi in up and m2 + 12 <= 86:
                m2 += 12
            notes.append((bi * 4 + bt, m2, vm))
    if passing:
        extra = []
        for k in range(len(notes) - 1):
            t0, m0, _ = notes[k]
            t1, m1, _ = notes[k + 1]
            if t1 - t0 >= 1.0 and m0 != m1:
                d = 1 if m1 > m0 else -1
                extra.append((t1 - 0.5, scale_step(m1, -d), 0.62))   # 다음 음으로 들어가는 경과음
        notes = sorted(notes + extra)
    return notes


def build_events():
    ev = []
    jr = np.random.default_rng(SEED + 1)          # 사람 손 흔들림(시간·세기)
    bar_chord = []
    for s in SECS:
        b0 = s["start"]
        for pi, ph in enumerate(s["phr"].split()):
            prog = PROG["A" if ph.startswith("A") else ph]
            pb = b0 + pi * 4
            bar_chord += prog
            for beat, m, vm in phrase_melody(ph, prog):
                bar = pb + int(beat // 4)
                prog_pos = (bar - b0 + (beat % 4) / 4) / s["bars"]
                pv = s["pv"][0] + (s["pv"][1] - s["pv"][0]) * prog_pos
                t = pb * BAR + beat * BEAT + jr.uniform(-0.008, 0.008)
                end = (bar + 1) * BAR + 0.04                # 마디 끝에서 페달을 뗀다
                ev.append(dict(t=t, ins="piano", m=m, d=end - t, v=pv * vm * (1 + 0.06 * jr.uniform(-1, 1))))
    assert len(bar_chord) == BARS

    for bar in range(BARS):
        s = SECS[max(i for i, x in enumerate(SECS) if x["start"] <= bar)]
        bl = bar - s["start"]
        ch = bar_chord[bar]
        r, voi = CHORD[ch]
        t0 = bar * BAR
        end = t0 + BAR + 0.04
        pv = s["pv"][0] + (s["pv"][1] - s["pv"][0]) * bl / s["bars"]
        lh = s["lh"]
        root = low_root(r)

        def pn(t, m, v):
            t += jr.uniform(-0.006, 0.006)
            ev.append(dict(t=t, ins="piano", m=m, d=end - t, v=v * (1 + 0.05 * jr.uniform(-1, 1))))

        if lh in ("root", "roll", "roll2", "arp") or (lh == "root6" and bl < 6):
            pn(t0, root, pv * 0.72)
        if lh in ("roll", "roll2"):
            for k, m in enumerate(voi):
                pn(t0 + 0.05 + 0.045 * k, m, pv * (0.62 - 0.03 * k))
            if lh == "roll2" and bl % 2 == 1:
                for k, m in enumerate(voi[2:]):
                    pn(t0 + 2.5 * BEAT + 0.03 * k, m, pv * 0.40)
        if lh == "arp":
            L = voi + [voi[1] + 12]
            pat = [0, 1, 2, 3, 4, 3, 2]
            if bl < 2:
                for k, bt in enumerate((1, 2, 3)):
                    pn(t0 + bt * BEAT, L[pat[k * 2]], pv * 0.48)
            else:
                for k in range(7):
                    bt = 0.5 * (k + 1)
                    acc = 0.52 if bt == int(bt) else 0.44
                    pn(t0 + bt * BEAT, L[pat[k]], pv * acc)
        # 페달을 뗄 때 댐퍼 잡음(피아노가 울린 마디만)
        ev.append(dict(t=t0 + BAR - 0.02, ins="damper", m=60, d=0.3, v=pv))

        # 패드: 보이싱 + 근음(2옥타브대)
        proot = low_root(r, 41)
        for m in voi + [proot]:
            ev.append(dict(t=t0, ins="pad", m=m, d=BAR + 0.6, v=0.16 if m != proot else 0.11))

        # 고조 구간 심장박동 서브 펄스(2·4박 없이 1·3박 '쿵-쿵')와 셰이커
        if 42 <= bar <= 55:
            ramp = min(1.0, (bar - 41) / 6.0) * min(1.0, (56 - bar) / 3.0)
            for bt in (0, 2):
                ev.append(dict(t=t0 + bt * BEAT, ins="lub", m=0, d=0.3, v=0.5 * ramp))
                ev.append(dict(t=t0 + (bt + 0.3) * BEAT, ins="lub", m=0, d=0.3, v=0.3 * ramp))
        if 44 <= bar <= 55:
            ramp = min(1.0, (bar - 43) / 5.0) * min(1.0, (56 - bar) / 3.0)
            acc = [0.55, 0.3, 0.42, 0.3, 0.5, 0.3, 0.42, 0.34]
            for k in range(8):
                bt = 0.5 * k + (0.04 if k % 2 else 0.0)
                ev.append(dict(t=t0 + bt * BEAT + jr.uniform(-0.006, 0.006), ins="shaker", m=0, d=0.1,
                               v=acc[k] * ramp * (1 + 0.1 * jr.uniform(-1, 1))))
    ev.sort(key=lambda e: (e["t"], e["ins"], e["m"]))
    return ev, bar_chord


# ───────────────────────── 악기 ─────────────────────────
# 피아노·패드·펄스는 대역이 좁으므로(피아노 ≤ 5 kHz, 패드 ≤ 1.9 kHz, 펄스 ≤ 300 Hz) 낮은 표본율(SR/2·SR/4)로
# 원형 버스에 합성한 뒤 FFT 영 채움으로 44.1 kHz 로 올린다(대역 제한 보간이라 원형 루프가 그대로 유지됨).
RATE_DIV = {"piano": 2, "pad": 4, "pulse": 4, "shaker": 1}
_IMP = {}


def damped_sine(n, sr, f, tau, ph):
    """r^k·sin(ωk+φ) 를 2극 공진기 임펄스 응답(lfilter)으로 — exp·sin 직접 계산보다 몇 배 빠르고 수치적으로 같음."""
    from scipy.signal import lfilter
    imp = _IMP.get(n)
    if imp is None:
        imp = np.zeros(n)
        imp[0] = 1.0
        _IMP.clear()
        _IMP[n] = imp
    r = math.exp(-1.0 / (tau * sr))
    w = 2 * math.pi * f / sr
    return lfilter([math.sin(ph), r * math.sin(w - ph)], [1.0, -2 * r * math.cos(w), r * r], imp)


def ins_piano(m, dur, v, sr):
    """펠트 피아노: 배음마다 두 줄(빠른 감쇠 줄 + 0.15～0.85센트 어긋난 느린 감쇠 줄 → 2단 감쇠·맥놀이),
    약한 비조화(B=2.5e-4), 5 kHz 상한, 세기 따라 밝기, 부드러운 해머(5～17 ms 상승), 아주 작은 펠트 '툭',
    페달 뗀 뒤 댐퍼 감쇠."""
    f0 = mtof(m)
    hold = max(dur, 0.08)
    rel = 0.2 + 0.25 * min(1.0, 130.0 / f0)
    tau2 = float(np.clip(8.5 * (110.0 / f0) ** 0.55, 1.8, 11.0))
    tau1 = float(np.clip(1.0 * (220.0 / f0) ** 0.5, 0.25, 1.6))
    n = int((hold + 6 * rel) * sr)
    fb = 700 + 2400 * v
    det = 2 ** ((0.5 + 0.35 * math.sin(m * 1.7)) / 1200)
    y = np.zeros(n)
    norm = 0.0
    for k in range(1, 17):
        fk = k * f0 * math.sqrt(1 + 2.5e-4 * k * k)
        if fk > 5000:
            break
        a = k ** -1.1 * math.exp(-(k - 1) * f0 / fb)
        if a < 0.004:
            break
        ph = rng.random() * 2 * np.pi
        y += (0.6 * a) * damped_sine(n, sr, fk, tau1 / (1 + 0.35 * (k - 1)), ph)
        y += (0.4 * a) * damped_sine(n, sr, fk * det, tau2 / (1 + 0.18 * (k - 1)), ph + 1.3 * k)
        norm += a * a
    y /= math.sqrt(norm)
    ta = 0.005 + 0.012 * (1 - v)
    na = int(ta * sr)
    y[:na] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / na)
    ih = int(hold * sr)
    y[ih:] *= np.exp(-np.arange(n - ih) / (rel * sr))
    nt = int(0.04 * sr)
    th = rng.standard_normal(nt)
    fr = np.fft.rfftfreq(nt, 1 / sr)
    th = np.fft.irfft(np.fft.rfft(th) * lp_mag(fr, 250 + 900 * v, 2) * hp_mag(fr, 60, 1), n=nt)
    th /= max(1e-9, np.sqrt((th ** 2).mean()))
    tt = np.arange(nt) / sr
    y[:nt] += th * (1 - np.exp(-tt / 0.002)) * np.exp(-tt / 0.009) * 0.035
    return (y * v ** 1.5).astype(F32)


def ins_damper(v, sr):
    n = int(0.4 * sr)
    t = np.arange(n) / sr
    x = rng.standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / sr)
    x = np.fft.irfft(np.fft.rfft(x) * bpq(fr, 380, 0.7) * lp_mag(fr, 1200, 2), n=n)
    x /= max(1e-9, np.sqrt((x ** 2).mean()))
    e = (1 - np.exp(-t / 0.03)) * np.exp(-t / 0.09)
    return (x * e * 0.010 * v).astype(F32)


def ins_pad(f, dur, v, sr):
    """삼각파 두 개(±6센트, 좌우로 벌림), 1.6 s 상승 → 3 s 동안 0.9 로 → 끝에서 0.9 s 지수 해제(web_env 와 같은 모양)."""
    a_t, tau, sus, rel = 1.6, 3.0, 0.9, 0.9
    end = max(dur, a_t + 0.01)
    n = int((end + rel * 5) * sr)
    t = np.arange(n) / sr
    e = np.where(t < a_t, v * t / a_t, v * sus + v * (1 - sus) * np.exp(-(t - a_t) / tau))
    ie = int(end * sr)
    e[ie:] = e[ie - 1] * np.exp(-(t[ie:] - end) / rel)
    a = tri(f * 2 ** (-6 / 1200), t, rng.random())
    b = tri(f * 2 ** (6 / 1200), t, rng.random())
    gl1, gr1 = pan_gains(-0.55)
    gl2, gr2 = pan_gains(0.55)
    return np.stack([(a * gl1 + b * gl2) * e, (a * gr1 + b * gr2) * e]).astype(F32)


def ins_lub(v, sr):
    """심장박동 같은 서브 펄스: 62→44 Hz 하강 사인, 6 ms 상승, 0.11 s 감쇠, 약한 포화(작은 스피커용 배음)."""
    n = int(0.6 * sr)
    t = np.arange(n) / sr
    f = np.where(t < 0.08, 62 * (44 / 62) ** (t / 0.08), 44.0)
    ph = 2 * np.pi * np.cumsum(f) / sr
    e = (1 - np.exp(-t / 0.006)) * np.exp(-t / 0.11)
    y = np.tanh(1.4 * np.sin(ph) * e) / np.tanh(1.4)
    return (y * v).astype(F32)


def ins_shaker(v, sr):
    n = int(0.14 * sr)
    t = np.arange(n) / sr
    x = rng.standard_normal(n)
    fr = np.fft.rfftfreq(n, 1 / sr)
    x = np.fft.irfft(np.fft.rfft(x) * bpq(fr, 3600, 1.1) * lpq(fr, 6000, 0.7), n=n)
    x /= max(1e-9, np.sqrt((x ** 2).mean()))
    e = (1 - np.exp(-t / 0.006)) * np.exp(-t / 0.035)
    return (x * e * v * 0.5).astype(F32)


BUS_OF = {"piano": "piano", "damper": "piano", "pad": "pad", "lub": "pulse", "shaker": "shaker"}


def synth(e, sr):
    ins = e["ins"]
    if ins == "piano":
        return ins_piano(e["m"], e["d"], e["v"], sr), float(np.clip((e["m"] - 62) / 40.0, -0.45, 0.45))
    if ins == "damper":
        return ins_damper(e["v"], sr), 0.0
    if ins == "pad":
        return ins_pad(mtof(e["m"]), e["d"], e["v"], sr), 0.0
    if ins == "lub":
        return ins_lub(e["v"], sr), 0.0
    if ins == "shaker":
        return ins_shaker(e["v"], sr), 0.3
    raise ValueError(ins)


def add_d(buf, t0, sig, pan, D):
    """add() 의 낮은 표본율 판(원형 버퍼 길이 N/D)."""
    nl = buf.shape[1]
    if sig.ndim == 1:
        gl, gr = pan_gains(pan)
        sig = np.stack([sig * gl, sig * gr])
    n = sig.shape[1]
    i0 = int(round(t0 * SR / D)) % nl
    end = i0 + n
    if end <= nl:
        buf[:, i0:end] += sig
    else:
        k = nl - i0
        buf[:, i0:] += sig[:, :k]
        buf[:, : n - k] += sig[:, k:]


def up_filter(x, D, mag_fn):
    """낮은 표본율 원형 버스를 주파수 영역에서 걸러(mag_fn) 44.1 kHz 로 올린다(영 채움 = 대역 제한 보간)."""
    nl = x.shape[1]
    X = np.fft.rfft(x, axis=-1)
    X *= mag_fn(np.fft.rfftfreq(nl, D / SR))
    if D == 1:
        return np.fft.irfft(X, n=N, axis=-1).astype(F32)
    X[:, -1] *= 0.5
    Y = np.zeros((2, N // 2 + 1), dtype=X.dtype)
    Y[:, :X.shape[1]] = X * D
    del X
    return np.fft.irfft(Y, n=N, axis=-1).astype(F32)


def automation_d(points, D):
    xs = np.array([p[0] * BAR for p in points])
    ys = np.array([p[1] for p in points])
    return np.interp(np.arange(N // D, dtype=np.float64) * D / SR, xs, ys).astype(F32)


# ───────────────────────── 이펙트·질감 ─────────────────────────

PADLV = [(0, .30), (6, .30), (8, .40), (14, .42), (16, .72), (28, .85), (40, .92), (50, 1.05), (54, .95),
         (56, .62), (66, .55), (68, .42), (76, .34), (80, .30)]
BRIGHT = [(0, 0.0), (8, .10), (16, .35), (28, .45), (40, .60), (50, 1.0), (54, .80), (56, .35), (68, .08), (80, 0.0)]
GAIN = {"piano": 1.0, "pad": 0.55, "pulse": 0.22, "shaker": 0.25}
LEVEL_DB = [(0, 4.0), (8, 3.2), (16, 1.2), (28, 0.4), (40, 0.0), (46, -0.7), (54, -0.7), (56, 0.0), (64, 1.0),
            (68, 2.2), (76, 3.6), (80, 4.0)]
LOW_SHELF_DB = -2.5


def tape_wobble(x):
    """테이프 워블(compose_lofi.py 와 같은 원형 분수 지연, 깊이만 WOBBLE 배). 주기는 300초 정수배."""
    f1, f2, f3 = loopf(0.37), loopf(1.1), loopf(5.3)
    out = np.empty_like(x)
    CH = 1 << 20
    for i0 in range(0, N, CH):
        i = np.arange(i0, min(N, i0 + CH), dtype=np.float64)
        t = i / SR
        d = 0.0015 + WOBBLE * (0.0009 * np.sin(2 * np.pi * f1 * t) + 0.00025 * np.sin(2 * np.pi * f2 * t + 1.0)
                               + 0.00004 * np.sin(2 * np.pi * f3 * t + 2.0))
        p = i - d * SR
        k = np.floor(p).astype(np.int64)
        fr = (p - k).astype(F32)
        out[:, i0:i0 + len(i)] = x[:, k % N] * (1 - fr) + x[:, (k + 1) % N] * fr
    return out


def tape_hiss(ref_rms):
    f = freqs()
    h = rng.standard_normal((2, N), dtype=F32)
    h = fd_filter(h, hp_mag(f, 300, 1) * lp_mag(f, 4500, 2))
    h *= F32(1.0 / np.sqrt((h.astype(np.float64) ** 2).mean()))
    return h * F32(0.004 * ref_rms)


def rms_db(x):
    return 20 * math.log10(max(1e-12, float(np.sqrt((x.astype(np.float64) ** 2).mean()))))


def render(events, log=print):
    t_start = time.time()
    st = lambda msg: log(f"  [{time.time() - t_start:5.1f}s] {msg}")
    f = freqs()
    by_bus = {}
    for e in events:
        by_bus.setdefault(BUS_OF[e["ins"]], []).append(e)

    dry = new_bus()
    rev = new_bus()
    SEND = {"piano": 0.34, "pad": 0.5, "pulse": 0.0, "shaker": 0.12}
    for name in ("piano", "pad", "pulse", "shaker"):
        D = RATE_DIV[name]
        sr = SR / D
        low = np.zeros((2, N // D), dtype=F32)
        for e in by_bus.get(name, []):
            sig, pan = synth(e, sr)
            add_d(low, e["t"], sig, pan, D)
        if name == "piano":
            bus = up_filter(low, D, lambda fr: hp_mag(fr, 35, 2) * lpq(fr, 4800, 0.6))
        elif name == "pad":
            w = automation_d(BRIGHT, D)[None, :]
            nl = low.shape[1]
            X = np.fft.rfft(low, axis=-1)
            frl = np.fft.rfftfreq(nl, D / SR)
            hp = hp_mag(frl, 70, 1)
            hi = np.fft.irfft(X * (lpq(frl, 1900, 0.7) * hp), n=nl, axis=-1).astype(F32)
            lo = np.fft.irfft(X * (lpq(frl, 620, 0.7) * hp), n=nl, axis=-1).astype(F32)
            del X
            hi -= lo
            hi *= w
            lo += hi
            lo *= automation_d(PADLV, D)[None, :]
            del hi, w
            bus = up_filter(lo, D, lambda fr: np.ones_like(fr))
            del lo
        elif name == "pulse":
            bus = up_filter(low, D, lambda fr: lpq(fr, 300, 0.7) * hp_mag(fr, 28, 2))
        else:
            bus = up_filter(low, D, lambda fr: hpq(fr, 1500, 0.7) * lpq(fr, 6500, 0.7))
        del low
        bus *= F32(GAIN[name])
        st(f"{name}: {len(by_bus.get(name, []))}음(1/{D} 표본율), 버스 RMS {rms_db(bus):.1f} dB")
        dry += bus
        if SEND[name]:
            rev += F32(SEND[name]) * bus
        del bus

    wet = circ_conv(rev, reverb_ir(4.5, 3.6, 1.2))
    del rev
    wet = fd_filter(wet, hp_mag(f, 150, 1) * lpq(f, 2800, 0.7))
    dry += F32(0.55) * wet
    del wet
    st("reverb")

    dry = tape_wobble(dry)
    st("tape wobble")
    # 구간 레벨 오토메이션(dB, 마디 기준 선형 보간, 처음=끝): 인트로·아웃트로를 올리고 고조를 살짝 낮춰 구간 차를 줄인다
    dry *= (10 ** (automation(LEVEL_DB) / 20)).astype(F32)[None, :]
    ref = float(np.sqrt((dry.astype(np.float64) ** 2).mean()))
    dry += tape_hiss(ref)
    st("tape hiss")

    # 저역 정리: 200 Hz 아래 저역 셸프 −2.5 dB + 90 Hz 1차(6 dB/옥타브) 하이패스
    g = 10 ** (LOW_SHELF_DB / 20)
    shelf = np.sqrt((g * g + (f / 200.0) ** 2) / (1 + (f / 200.0) ** 2))
    mix = fd_filter(dry, hp_mag(f, 25, 2) * hp_mag(f, 90, 1) * shelf * lpq(f, 9500, 0.7))
    del shelf
    del dry
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


# ───────────────────────── 분석·보고(compose_lofi.py 에서 복사·조정) ─────────────────────────

def analyze(x, outdir, mp3info, gr, wall, events, bar_chord, mem):
    L = []
    x64 = x.astype(np.float64)
    mono = x.mean(axis=0).astype(F32)
    P, fr, tfr = stft_power(mono)
    hf = fr >= 8000

    def centroid(t0, t1):
        m = (tfr >= t0) & (tfr < t1)
        p = P[m].astype(np.float64).sum(axis=0)
        return float((fr * p).sum() / p.sum())

    def hf_db(t0, t1):
        m = (tfr >= t0) & (tfr < t1)
        p = P[m].astype(np.float64).sum(axis=0)
        return 10 * math.log10(max(1e-20, p[hf].sum() / p.sum()))

    def row(label, t0, t1):
        seg = x64[:, int(t0 * SR):int(t1 * SR)]
        return (f"| {label} | {mmss(t0)}～{mmss(t1)} | {db(math.sqrt((seg ** 2).mean())):.2f} | "
                f"{db(np.abs(seg).max()):.2f} | {loudness(seg):.2f} | {centroid(t0, t1):.0f} | {hf_db(t0, t1):.1f} |")

    npiano = sum(1 for e in events if e["ins"] == "piano")
    L.append(f"# {TITLE} — 5분 BGM 합성 보고 (활동 단계 {STAGE} · 한가)\n")
    L.append(f"- 자체 작곡, {BPM} BPM 4/4, {KEY}(7·9화음), 외부 샘플·인용 없음")
    L.append(f"- 길이 {DUR:.3f}초 = {BARS}마디 × {BAR:.4f}초, 44.1kHz 스테레오, 시드 {SEED}(numpy)")
    L.append(f"- 사건 {len(events):,}개(피아노 {npiano}음), 합성·분석 소요 {wall:.1f}초, 최대 메모리 {mem}, "
             f"리미터 최대 감쇠 {gr:.2f} dB\n")

    L.append("## 곡 구조\n")
    L.append("| 단계 | 구간 | 시간 | 마디 | 선율 틀 | 화성 | 내용 |")
    L.append("|---|---|---|---|---|---|---|")
    for s in SECS:
        t0, t1 = tb(s["start"]), tb(s["start"] + s["bars"])
        chs = bar_chord[s["start"]:s["start"] + s["bars"]]
        prog = " / ".join("–".join(chs[i:i + 4]) for i in range(0, len(chs), 4))
        L.append(f"| {s['part']} | {s['n']} | {mmss(t0)}～{mmss(t1)} | {s['start']}～{s['start'] + s['bars'] - 1} | "
                 f"{s['p']} | {prog} | {s['desc']} |")
    L.append("\n- 음색: 펠트 피아노(배음 16개 이하·5kHz 상한, 배음마다 두 줄 공진기 — 빠른 감쇠 τ 0.25～1.6 s 줄과 느린 감쇠 τ 1.8～11 s 줄로 2단 감쇠, 비조화도 2.5e-4, "
             "두 줄 0.15～0.85센트 맥놀이, 1/2 표본율 합성 후 대역 제한 보간, 해머 상승 5～17 ms·세기 따라 밝기, 펠트 '툭' −29 dB, 마디 끝 페달·댐퍼 잡음), "
             "삼각파 패드(±6센트, 620Hz↔1.9kHz 밝기 자동화), 심장박동 서브 펄스(62→44Hz, 1·3박 쿵-쿵, 42～55마디), "
             "셰이커(3.6kHz 대역 잡음, 6kHz 저역 통과, 44～55마디)")
    L.append("- 질감: 테이프 히스(300Hz～4.5kHz, 믹스 RMS 대비 −48 dB), 테이프 워블(로파이 곡의 0.45배), "
             "합성 IR 리버브 4.5 s(RT60 저역 3.6 s / 고역 1.2 s), 마스터 9.5kHz 저역 통과")
    L.append("- 마스터 다듬기: 구간 레벨 오토메이션(인트로 +4.0 · 아웃트로 +3.6～4.0 · 고조 −0.7 dB, 마디 사이 선형 보간, 히스 앞 적용) → "
             "구간 LUFS 차 약 5 LU, 저역 셸프 200Hz 아래 −2.5 dB + 90Hz 1차 하이패스\n")

    L.append("## 구간별 에너지·밝기\n")
    L.append("| 구간 | 시간 | RMS(dBFS) | 피크(dBFS) | LUFS(근사) | 스펙트럼 중심(Hz) | 8kHz 이상 에너지(dB) |")
    L.append("|---|---|---|---|---|---|---|")
    for s in SECS:
        L.append(row(f"{s['part']} · {s['n']}", tb(s["start"]), tb(s["start"] + s["bars"])))
    for part in ("기", "승", "전", "결"):
        ss = [s for s in SECS if s["part"] == part]
        L.append(row(f"**{part}**", tb(ss[0]["start"]), tb(ss[-1]["start"] + ss[-1]["bars"])))
    L.append(row("2:30～3:30 고조", 150, 210))
    total_lufs = loudness(x)
    total_pk = db(np.abs(x64).max())
    total_hf = hf_db(0, DUR + 1)
    L.append(row("**전체**", 0, DUR))
    L.append("\n(8kHz 이상 에너지 = 전체 스펙트럼 전력 대비 8kHz 이상 전력 비율)\n")

    L.append("## 15초 창 RMS 곡선\n")
    L.append("```")
    rms15 = []
    for wi in range(20):
        seg = x64[:, wi * 15 * SR:(wi + 1) * 15 * SR]
        r = db(math.sqrt((seg ** 2).mean()))
        rms15.append(r)
        sec = [s for s in SECS if tb(s["start"]) <= wi * 15 + 7.5][-1]
        L.append(f"{mmss(wi * 15)}  {sec['part']} {sec['n']:<6s} {r:7.2f}  " + "■" * max(0, int(round(r + 40))))
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
    L.append("- 원형 버퍼 합성: 마지막 마디 C9sus4 의 피아노·패드·리버브 꼬리가 첫 마디 Fmaj9 위로 감김(딸림 → 으뜸 해결). "
             "패드 세기·밝기 자동화는 처음과 끝 값이 같고(0.30·0), 워블 LFO 는 300초 정수 주기, 히스는 일정. "
             "MP3 인코더 지연(약 25ms)은 남음\n")

    L.append("## 검사\n")
    ok_len = abs(mp3info["secs"] - DUR) <= 0.5
    ok_sz = mp3info["size"] <= 8 * 1024 * 1024
    ok_pk = total_pk <= CEIL_DB + 1e-6
    ok_lu = abs(total_lufs - TARGET_LUFS) <= 0.5
    ok_hf = total_hf <= -30.0
    L.append("| 항목 | 기준 | 값 | 결과 |")
    L.append("|---|---|---|---|")
    L.append(f"| 길이(MP3 프레임) | 300±0.5초 | {mp3info['secs']:.3f}초({mp3info['frames']}프레임) | {'통과' if ok_len else '실패'} |")
    L.append(f"| 크기 | 8MB 이하 | {mp3info['size']:,} bytes ({mp3info['size'] / 1048576:.2f} MB) | {'통과' if ok_sz else '실패'} |")
    L.append(f"| 샘플 피크(PCM) | ≤ {CEIL_DB} dBFS | {total_pk:.2f} dBFS | {'통과' if ok_pk else '실패'} |")
    L.append(f"| 통합 라우드니스 | −16±0.5 LUFS | {total_lufs:.2f} LUFS | {'통과' if ok_lu else '실패'} |")
    L.append(f"| 8kHz 이상 에너지 | ≤ −30 dB | {total_hf:.1f} dB | {'통과' if ok_hf else '실패'} |")
    L.append(f"\n- MP3 {BITRATE}kbps CBR, sha256 `{mp3info['sha']}`")
    L.append(f"- PCM(int16) sha256 `{mp3info['pcm_sha']}`")
    L.append("- 피크·라우드니스는 인코딩 전 PCM 기준\n")
    L.append("![스펙트로그램](spectrogram.png)")
    with open(os.path.join(outdir, "report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

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
    r1 = [db(math.sqrt((x64[:, i:i + SR] ** 2).mean())) for i in range(0, N, SR)]
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
    return ok_len and ok_sz and ok_pk and ok_lu and ok_hf, total_lufs, total_pk


def peak_mem():
    try:
        import psutil
        mi = psutil.Process().memory_info()
        v = getattr(mi, "peak_wset", None) or mi.rss
        return f"{v / 1048576:,.0f} MB"
    except Exception:
        return "측정 안 됨"


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="'새벽 피아노' BGM 합성")
    ap.add_argument("--out", default="bgm-dawn.mp3", help="MP3 출력 경로(json·report·png 는 같은 폴더)")
    ap.add_argument("--wav", default=None, help="미리듣기용 16bit WAV(선택)")
    args = ap.parse_args(argv)
    t0 = time.time()
    print(f"합성 시작: {BPM} BPM, {BARS}마디, {DUR:.3f}초, seed {SEED}")
    events, bar_chord = build_events()
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
    meta = {"title": TITLE, "mood": MOOD, "stage": STAGE, "energy": ENERGY, "duration": int(round(DUR)),
            "bpm": BPM, "key": KEY,
            "sections": [{"name": s["n"], "part": s["part"], "start": round(tb(s["start"]), 3)} for s in SECS],
            "seed": SEED}
    with open(base + ".json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
        fh.write("\n")
    frames, secs = mp3_frames(mp3)
    info = dict(frames=frames, secs=secs, size=len(mp3), sha=hashlib.sha256(mp3).hexdigest(),
                pcm_sha=hashlib.sha256(pcm.tobytes()).hexdigest())
    del pcm
    ok, lu, pk = analyze(mix, outdir, info, gr, time.time() - t0, events, bar_chord, peak_mem())
    print(f"MP3: {out}  {len(mp3):,} bytes, {secs:.3f}초, LUFS {lu:.2f}, 피크 {pk:.2f} dBFS")
    print(f"  sha256 {info['sha']}")
    print(f"  최대 메모리 {peak_mem()}, 총 소요 {time.time() - t0:.1f}초, 검사:", "통과" if ok else "실패")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
