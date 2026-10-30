#!/usr/bin/env python3
"""'중력 선회' — Planet(Cosmic Ambient) 활발(2단계) 배경음악.

멜로딕 프로그레시브: 3개씩 묶인 16분 플럭 아르페지오가 4박과 엇갈려 돌고(점8분 에코), 킥 사이를 메우는 16분 롤링 서브,
부드러운 포온더플로어 킥·셰이커, 현악 합주 화음, 클라이맥스에서 비브라폰 선율. 124 BPM 4/4 155마디 = 정확히 300초,
Eb major(Eb–Bb/D–Cm7–Abmaj7). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 빌드업(16～48) → 드롭(48～88) → 브레이크다운(88～104) → 클라이맥스(104～139) → 아웃트로(139～155)

  python music/compose_gravity.py --out <폴더>/bgm-gravity.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import (Layer, tb, lv, prog_at, melody, pattern, voicing, scale_of, saw_note, kick, clap, shaker, sub_note,
                    riser, bass_note, inst)

E.setup("gravity", "중력 선회",
        "활발 · 멜로딕 프로그레시브 — 3개 묶음 16분 플럭 아르페지오, 롤링 서브, 부드러운 킥·셰이커, 현악 화음, 비브라폰",
        "Eb major", 124, [
            {"n": "인트로", "part": "기", "bars": 16, "arp": 0.8, "kick": 0.0, "sub": 0.0, "shk": 0.6, "clap": 0.0, "str": 0.8, "vib": 0.0, "fx": 0.0, "filt": 0.3},
            {"n": "빌드업", "part": "승", "bars": 32, "arp": 1.0, "kick": 1.0, "sub": 1.0, "shk": 0.9, "clap": 0.5, "str": 0.7, "vib": 0.0, "fx": 1.0, "filt": 0.5},
            {"n": "드롭", "part": "전", "bars": 40, "arp": 1.0, "kick": 1.0, "sub": 1.0, "shk": 1.0, "clap": 1.0, "str": 0.8, "vib": 0.6, "fx": 1.0, "filt": 0.8},
            {"n": "브레이크다운", "part": "전", "bars": 16, "arp": 0.8, "kick": 0.0, "sub": 0.0, "shk": 0.4, "clap": 0.0, "str": 1.0, "vib": 0.8, "fx": 1.0, "filt": 0.4},
            {"n": "클라이맥스", "part": "전", "bars": 35, "arp": 1.0, "kick": 1.0, "sub": 1.0, "shk": 1.0, "clap": 1.0, "str": 0.9, "vib": 1.0, "fx": 1.0, "filt": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 16, "arp": 0.8, "kick": 0.0, "sub": 0.0, "shk": 0.6, "clap": 0.0, "str": 0.8, "vib": 0.0, "fx": 0.0, "filt": 0.3},
        ], stage=2, energy=0.66, reverb=(3.4, 2.6, 0.9), wet=0.38, echo_beats=0.75, echo_fb=0.5, master_lp=11500)

CH = prog_at(["Eb", "Bb/D", "Cm7", "Abmaj7"], per=4)
SC = scale_of(3, "major")
VB = [[(0, 3), (3, 3), (6, 2), (8, 4), (12, 4), (16, 3), (19, 3), (22, 2), (24, 8)], [(0, 2), (2, 2), (4, 4), (8, 8), (16, 2), (18, 2), (20, 4), (24, 8)]]


def build():
    arp = Layer("arp", dry=0.55, rev=0.35, echo=0.5, hp=300, sweep=(1200, 7000), tau=3.0, duck=0.3)
    kk = Layer("kick", dry=1.0, rev=0.05, lp=3000, tau=1.0)
    sub = Layer("sub", dry=1.0, lp=240, tau=1.0, duck=0.0)
    shk = Layer("shk", dry=0.6, rev=0.2, hp=4500, tau=1.5, gain=2.0)
    cl = Layer("clap", dry=0.6, rev=0.4, hp=600, tau=1.0, gain=2.5)
    st = Layer("str", dry=0.55, rev=0.55, hp=150, lp=5000, width=1.4, tau=4.0, duck=0.3, gain=0.6)
    vib = Layer("vib", dry=0.5, rev=0.45, echo=0.35, hp=400, lp=7000, tau=2.0)
    fx = Layer("fx", dry=0.6, rev=0.5, hp=400, tau=1.0)
    prev = None
    k3 = 0
    for bar in range(E.BARS):
        ch = CH(bar)
        if bar % 2 == 0:
            vo = voicing(ch, 55, 74, prev, maxn=4)
            prev = vo
            span = min(2, E.BARS - bar)
            for j, m in enumerate(vo):
                st.note(tb(bar), "strings", m, span * E.BAR - 0.1, 0.32, pan=-0.5 + j / 3)
        arpn = voicing(ch, 67, 84, None, maxn=4)
        for i in range(16):
            m = arpn[[0, 1, 2][k3 % 3] + (1 if (k3 // 3) % 2 and len(arpn) > 3 else 0)]
            k3 += 1
            arp.add(tb(bar, i / 4), saw_note(m, 0.08, 5000, 900, 0.05, 0.002, 0.08), 0.32 if i % 3 == 0 else 0.22,
                    pan=0.35 if (k3 % 3) == 1 else -0.35)
        if lv("kick", bar) > 0:
            pattern(kk, bar, "X---X---X---X---", lambda i: kick(52.0, 80.0, 0.03, 0.2, 0.25, 1.5), 0.75, kick=True)
        b = bass_note(ch, 31)
        for i in range(16):
            if i % 4:
                sub.add(tb(bar, i / 4), sub_note(b, E.BEAT * 0.2, 0.004, 0.03, 0.25, 1.6), 0.3 if i % 4 == 2 else 0.24)
        pattern(shk, bar, "x-o-x-oxx-o-x-ox", lambda i: shaker(i % 4), 0.2, 0.3)
        pattern(cl, bar, "----X-------X---", lambda i: clap(bar % 3), 0.35)
        if bar in (44, 100, 135):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 4, 900, 8500), 0.45)
    melody(vib, "vibes", 64, 24, [71, 72, 73], VB, CH, SC, 0.45, -0.15, lo=72, hi=88)
    melody(vib, "vibes", 88, 16, [74, 75], VB, CH, SC, 0.4, -0.15, lo=72, hi=88)
    melody(vib, "vibes", 104, 32, [71, 76, 73, 77], VB, CH, SC, 0.48, -0.15, lo=74, hi=90)
    return [arp, kk, sub, shk, cl, st, vib, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
