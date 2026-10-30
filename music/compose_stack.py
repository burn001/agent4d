#!/usr/bin/env python3
"""'스택 트레이스' — 흐름(Intense 코딩) 활발(2단계) 배경음악.

일렉트로 프로그레시브: 공진 필터가 천천히 열리는 16분 톱니 아르페지오, 뒷박 8분 베이스, 포온더플로어 킥·2·4박 클랩,
16분 클로즈 햇·뒷박 오픈 햇, 드롭에서 사각파 리드. 124 BPM 4/4 155마디 = 정확히 300초, C# minor(C#m–A–E–B).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 빌드업(16～40) → 드롭(40～80) → 브레이크다운(80～96) → 클라이맥스(96～136) → 아웃트로(136～155)

  python music/compose_stack.py --out <폴더>/bgm-stack.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import (Layer, tb, lv, prog_at, pads, melody, pattern, voicing, scale_of, saw_note, kick, clap, hat, riser,
                    bass_note)

E.setup("stack", "스택 트레이스",
        "활발 · 일렉트로 프로그레시브 — 공진 필터 16분 톱니 아르페지오, 뒷박 베이스, 포온더플로어 킥·클랩, 사각파 리드",
        "C# minor", 124, [
            {"n": "인트로", "part": "기", "bars": 16, "arp": 0.7, "bass": 0.0, "kick": 1.0, "clap": 0.0, "hat": 0.5, "lead": 0.0, "pad": 0.6, "fx": 0.0, "filt": 0.2},
            {"n": "빌드업", "part": "승", "bars": 24, "arp": 0.9, "bass": 1.0, "kick": 1.0, "clap": 0.8, "hat": 0.8, "lead": 0.0, "pad": 0.6, "fx": 1.0, "filt": 0.45},
            {"n": "드롭", "part": "전", "bars": 40, "arp": 1.0, "bass": 1.0, "kick": 1.0, "clap": 1.0, "hat": 1.0, "lead": 1.0, "pad": 0.8, "fx": 1.0, "filt": 0.75},
            {"n": "브레이크다운", "part": "전", "bars": 16, "arp": 0.8, "bass": 0.0, "kick": 0.0, "clap": 0.0, "hat": 0.3, "lead": 0.5, "pad": 1.0, "fx": 1.0, "filt": 0.35},
            {"n": "클라이맥스", "part": "전", "bars": 40, "arp": 1.0, "bass": 1.0, "kick": 1.0, "clap": 1.0, "hat": 1.0, "lead": 1.0, "pad": 0.9, "fx": 1.0, "filt": 0.95},
            {"n": "아웃트로", "part": "결", "bars": 19, "arp": 0.7, "bass": 0.0, "kick": 1.0, "clap": 0.0, "hat": 0.5, "lead": 0.0, "pad": 0.6, "fx": 0.0, "filt": 0.2},
        ], stage=2, energy=0.62, reverb=(2.2, 1.6, 0.6), wet=0.28, echo_beats=0.75, master_lp=12000)

CH = prog_at(["C#m", "A", "E", "B"], per=4)
SC = scale_of(1, "minor")
LEAD = [[(0, 2), (2, 2), (4, 3), (7, 1), (8, 4), (12, 2), (14, 2), (16, 6), (24, 2), (26, 2), (28, 4)],
        [(0, 3), (3, 3), (6, 2), (8, 2), (10, 2), (12, 4), (16, 3), (19, 3), (22, 2), (24, 8)]]
UPDN = [0, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 0, 3, 1, 2, 3]


def build():
    arp = Layer("arp", dry=0.6, rev=0.25, echo=0.3, hp=250, sweep=(900, 6500), tau=3.0, duck=0.35)
    bass = Layer("bass", dry=1.0, rev=0.02, lp=1100, tau=1.0, duck=0.55)
    kk = Layer("kick", dry=1.0, rev=0.04, lp=4000, tau=0.5, gain=0.55)
    cl = Layer("clap", dry=0.7, rev=0.35, hp=500, tau=1.0, gain=3.0)
    hh = Layer("hat", dry=0.7, rev=0.1, hp=6000, tau=1.0, gain=1.8)
    lead = Layer("lead", dry=0.55, rev=0.35, echo=0.4, lp=5500, hp=300, tau=2.0, duck=0.2, gain=0.7)
    pad = Layer("pad", dry=0.45, rev=0.6, hp=200, lp=3500, width=1.4, tau=4.0, duck=0.4)
    fx = Layer("fx", dry=0.6, rev=0.5, hp=400, tau=1.0)
    pads(pad, CH, 61, 76, every=4, v=0.12, a=1.2, rel=2.0, cents=16)
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 61, 80, None, maxn=4) + voicing(ch, 73, 85, None, maxn=2)
        for i in range(16):
            m = vo[UPDN[i] % len(vo)] + (12 if (i == 15 and bar % 2) else 0)
            arp.add(tb(bar, i / 4), saw_note(m, 0.09, 4200, 700, 0.06, 0.002, 0.04, q=3.0), 0.35 if i % 4 == 0 else 0.25,
                    pan=0.3 if i % 2 else -0.3)
        pattern(kk, bar, "X---X---X---X---", lambda i: kick(50.0, 110.0, 0.03, 0.22, 0.4, 1.7), 0.85, kick=True)
        pattern(cl, bar, "----X-------X---", lambda i: clap(bar % 3), 0.5)
        pattern(hh, bar, "x.o.x.o.x.o.x.oo", lambda i: hat(i % 4), 0.2, -0.15)
        pattern(hh, bar, "--x---x---x---x-", lambda i: hat(i % 3, True), 0.16, 0.2)
        b = bass_note(ch, 33)
        for i in range(4):
            bass.add(tb(bar, i + 0.5), saw_note(b, E.BEAT * 0.4, 1300, 250, 0.05, 0.003, 0.04), 0.55)
            bass.add(tb(bar, i + 0.75), saw_note(b + 12, E.BEAT * 0.2, 1300, 250, 0.05, 0.003, 0.04), 0.3)
        if bar in (36, 92, 132):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 3), 0.5)
        if bar in (40, 96):
            fx.add(tb(bar), hat(7, True), 0.6)
    melody(lead, "square", 40, 40, [41, 42, 43, 44], LEAD, CH, SC, 0.4, 0.1, lo=68, hi=85)
    melody(lead, "square", 80, 16, [45, 46], LEAD, CH, SC, 0.3, 0.1, lo=68, hi=85, legato=1.2)
    melody(lead, "square", 96, 40, [41, 47, 43, 48], LEAD, CH, SC, 0.42, 0.1, lo=70, hi=87)
    return [arp, bass, kk, cl, hh, lead, pad, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
