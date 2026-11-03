#!/usr/bin/env python3
"""'다섯 박 루프'(Pentameter) — 흐름(Intense 코딩)·Planet(Cosmic Ambient) 공유 풀 보통(1단계) 배경음악.

5/4(3+2) 그루브: 오르간 화음이 3+2 자리에 끊어 들어오고, 8분 실로폰 분산화음, 1·4박 킥과 3·5박 클랩, 8분 하이햇,
서브 베이스, 선율 구간에 사각파 리드. 100 BPM 5/4 100마디 = 정확히 300초, Db lydian(Dbmaj7#11–Bbm9–Gbmaj9–Ab6).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～10) → 전개(10～38) → 선율(38～68) 사각파 리드 → 브레이크(68～76) → 다시(76～90) → 아웃트로(90～100)

  python music/compose_pentameter.py --out <폴더>/bgm-pentameter.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, melody, voicing, scale_of, kick, clap, hat, sub_note, bass_note

E.setup("pentameter", "다섯 박 루프",
        "보통 · 5/4(3+2) 그루브 — 3+2 자리에 끊는 오르간 화음, 8분 실로폰 분산화음, 1·4박 킥과 3·5박 클랩, 서브 베이스, 사각파 리드",
        "Db lydian", 100, [
            {"n": "인트로", "part": "기", "bars": 10, "organ": 0.6, "xylo": 0.8, "kick": 0.0, "clap": 0.0, "hat": 0.0, "sub": 0.5, "lead": 0.0, "pad": 1.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 28, "organ": 1.0, "xylo": 1.0, "kick": 1.0, "clap": 0.8, "hat": 0.7, "sub": 1.0, "lead": 0.0, "pad": 0.8, "filt": 0.5},
            {"n": "선율", "part": "전", "bars": 30, "organ": 0.9, "xylo": 0.6, "kick": 1.0, "clap": 1.0, "hat": 1.0, "sub": 1.0, "lead": 1.0, "pad": 0.8, "filt": 0.75},
            {"n": "브레이크", "part": "전", "bars": 8, "organ": 0.6, "xylo": 1.0, "kick": 0.0, "clap": 0.0, "hat": 0.4, "sub": 0.5, "lead": 0.5, "pad": 1.0, "filt": 0.4},
            {"n": "다시", "part": "결", "bars": 14, "organ": 1.0, "xylo": 1.0, "kick": 1.0, "clap": 1.0, "hat": 1.0, "sub": 1.0, "lead": 0.5, "pad": 0.8, "filt": 0.6},
            {"n": "아웃트로", "part": "결", "bars": 10, "organ": 0.6, "xylo": 0.8, "kick": 0.0, "clap": 0.0, "hat": 0.0, "sub": 0.5, "lead": 0.0, "pad": 1.0, "filt": 0.3},
        ], stage=1, energy=0.44, beats=5, reverb=(3.0, 2.3, 0.9), wet=0.36, echo_beats=1.5, master_lp=11000)

CH = prog_at(["Dbmaj7#11", "Bbm9", "Gbmaj9", "Ab6"], per=2)
SC = scale_of(1, "lydian")
STABS = ((0.0, 1.2, 0.3), (1.5, 0.45, 0.2), (3.0, 1.0, 0.27), (4.5, 0.4, 0.18))  # (박, 길이 박, 세기) — 3+2 무리
XSHAPE = [0, 2, 1, 3, 2, 0, 3, 1, 4, 2]
LD = [[(0, 3), (3, 1), (4, 2), (6, 4), (10, 2), (12, 2), (14, 6), (20, 3), (23, 1), (24, 4), (30, 10)],
      [(0, 2), (2, 2), (4, 6), (10, 4), (14, 2), (16, 4), (20, 2), (22, 2), (24, 6), (30, 10)]]


def build():
    org = Layer("organ", dry=0.6, rev=0.35, echo=0.2, lp=4200, hp=160, tau=2.0, duck=0.2, width=1.2, gain=0.45)
    xy = Layer("xylo", dry=0.55, rev=0.35, echo=0.35, lp=7000, hp=300, tau=2.5, gain=0.6)
    kk = Layer("kick", dry=1.0, rev=0.06, lp=1500, tau=1.0)
    cp = Layer("clap", dry=0.7, rev=0.3, hp=500, tau=1.5, gain=4.0)
    hh = Layer("hat", dry=0.6, rev=0.15, hp=6000, tau=1.5, gain=2.2)
    sub = Layer("sub", dry=1.0, lp=220, tau=2.0, duck=0.3)
    ld = Layer("lead", dry=0.55, rev=0.45, echo=0.35, lp=5200, hp=250, tau=3.0)
    pad = Layer("pad", dry=0.45, rev=0.6, hp=140, sweep=(600, 3200), width=1.4, tau=5.0)
    pads(pad, CH, 56, 72, every=2, v=0.1, a=2.5, rel=3.0, cents=10)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 60, 74, prev, rootless=True, maxn=4)
        prev = vo
        for bt, d, v in STABS:
            for j, m in enumerate(vo):
                org.note(tb(bar, bt) + 0.004 * j, "organ", m, E.BEAT * d, v, pan=-0.15 + 0.1 * j)
        xv = voicing(ch, 70, 88, None, maxn=5)
        for i in range(10):
            xy.note(tb(bar, i / 2), "xylo", xv[XSHAPE[i] % len(xv)], 0.25, 0.4 if i in (0, 6) else 0.26, pan=0.35 - 0.07 * i)
        if lv("kick", bar) > 0:
            kk.kick(tb(bar), kick(47.0, 70.0, 0.03, 0.26, 0.15, 1.4), 0.62)
            kk.kick(tb(bar, 3), kick(47.0, 70.0, 0.03, 0.26, 0.15, 1.4), 0.5)
            if bar % 4 == 3:
                kk.kick(tb(bar, 4.5), kick(47.0, 70.0, 0.03, 0.26, 0.15, 1.4), 0.3)
        if lv("clap", bar) > 0:
            cp.hit(tb(bar, 2), clap(bar % 3), 0.3)
            cp.hit(tb(bar, 4), clap((bar + 1) % 3), 0.26)
        if lv("hat", bar) > 0:
            for i in range(10):
                hh.hit(tb(bar, i / 2), hat(i % 4), 0.14 if i % 2 else 0.09, pan=-0.2)
        b = bass_note(ch, 32)
        sub.add(tb(bar), sub_note(b, E.BEAT * 2.7, 0.01, 0.12, 0.12), 0.36)
        sub.add(tb(bar, 3), sub_note(b + 12 if bar % 2 else b, E.BEAT * 1.7, 0.01, 0.12, 0.12), 0.3)
    melody(ld, "square", 38, 28, [501, 502, 503, 504], LD, CH, SC, 0.32, 0.1, lo=68, hi=85)
    melody(ld, "square", 68, 8, [505, 506], LD, CH, SC, 0.24, 0.1, lo=68, hi=85)
    melody(ld, "square", 76, 12, [501, 502, 503], LD, CH, SC, 0.26, 0.1, lo=68, hi=85)
    return [org, xy, kk, cp, hh, sub, ld, pad]


if __name__ == "__main__":
    sys.exit(E.run(build))
