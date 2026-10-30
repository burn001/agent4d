#!/usr/bin/env python3
"""'이온 폭풍' — Planet(Cosmic Ambient) 활발(2단계) 배경음악.

코스믹 브로큰비트: 엇갈려 들어오는 킥·스네어와 고스트, 옥타브로 뛰는 8분 톱니 베이스, 포먼트 합창 '아' 패드,
FM 벨 선율, 정전기 같은 잡음 상승. 120 BPM 4/4 150마디 = 정확히 300초, F minor(Fm9–Dbmaj7–Bbm9–C7sus).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 빌드업(16～40) → 드롭(40～80) → 브레이크다운(80～96) → 클라이맥스(96～134) → 아웃트로(134～150)

  python music/compose_ionstorm.py --out <폴더>/bgm-ionstorm.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import (Layer, tb, lv, prog_at, pattern, voicing, scale_of, saw_note, kick, snare, hat, riser, bell,
                    bass_note, inst)

E.setup("ionstorm", "이온 폭풍",
        "활발 · 코스믹 브로큰비트 — 엇갈리는 킥·스네어, 옥타브 8분 톱니 베이스, 합창 패드, FM 벨 선율, 정전기 잡음 상승",
        "F minor", 120, [
            {"n": "인트로", "part": "기", "bars": 16, "drums": 0.0, "hat": 0.6, "bass": 0.6, "choir": 1.0, "bell": 0.0, "fx": 0.0, "filt": 0.3},
            {"n": "빌드업", "part": "승", "bars": 24, "drums": 0.8, "hat": 0.9, "bass": 1.0, "choir": 0.8, "bell": 0.0, "fx": 1.0, "filt": 0.5},
            {"n": "드롭", "part": "전", "bars": 40, "drums": 1.0, "hat": 1.0, "bass": 1.0, "choir": 0.8, "bell": 1.0, "fx": 1.0, "filt": 0.8},
            {"n": "브레이크다운", "part": "전", "bars": 16, "drums": 0.0, "hat": 0.4, "bass": 0.5, "choir": 1.0, "bell": 0.7, "fx": 1.0, "filt": 0.4},
            {"n": "클라이맥스", "part": "전", "bars": 38, "drums": 1.0, "hat": 1.0, "bass": 1.0, "choir": 0.9, "bell": 1.0, "fx": 1.0, "filt": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 16, "drums": 0.0, "hat": 0.6, "bass": 0.6, "choir": 1.0, "bell": 0.0, "fx": 0.0, "filt": 0.3},
        ], stage=2, energy=0.6, reverb=(3.6, 2.8, 1.0), wet=0.4, echo_beats=0.75, echo_fb=0.5, master_lp=11500)

CH = prog_at(["Fm9", "Dbmaj7", "Bbm9", "C7sus"], per=4)
SC = scale_of(5, "minor")
KICK = ["X--x--X---x-----", "X--x----x-X--x--"]
SNR = ["----X--.-.--X---", "----X-----.-X-.x"]
BL = [[(0, 2), (2, 2), (4, 4), (10, 2), (12, 4), (16, 2), (18, 2), (20, 4), (26, 2), (28, 4)],
      [(0, 6), (6, 2), (8, 4), (12, 4), (16, 3), (19, 3), (22, 2), (24, 8)]]


def build():
    dr = Layer("drums", dry=0.9, rev=0.15, lp=9000, tau=1.0, drive=0.3, gain=0.8)
    hh = Layer("hat", dry=0.65, rev=0.15, hp=6500, tau=1.0, gain=1.5)
    bass = Layer("bass", dry=1.0, rev=0.03, hp=30, sweep=(500, 2400), tau=1.5, duck=0.45)
    choir = Layer("choir", dry=0.45, rev=0.65, hp=200, lp=4500, width=1.5, tau=4.0, duck=0.25, gain=0.35)
    bl = Layer("bell", dry=0.45, rev=0.45, echo=0.45, hp=500, lp=8000, tau=2.0)
    fx = Layer("fx", dry=0.55, rev=0.55, hp=600, tau=1.0)
    prev = None
    for bar in range(0, E.BARS, 4):
        span = min(4, E.BARS - bar)
        vo = voicing(CH(bar), 60, 77, prev, maxn=4)
        prev = vo
        for i, m in enumerate(vo):
            choir.add(tb(bar), inst("choirah", m, span * E.BAR + 0.3, 0.5), 1.0, pan=-0.6 + 0.4 * i)
    for bar in range(E.BARS):
        ch = CH(bar)
        b = bass_note(ch, 29)
        for i in range(8):
            m = b + (12 if i % 2 else 0)
            bass.add(tb(bar, i / 2), saw_note(m, E.BEAT * 0.38, 1800, 260, 0.06, 0.003, 0.04, q=1.6), 0.5 if i % 2 == 0 else 0.4)
        if lv("drums", bar) > 0:
            pattern(dr, bar, KICK[(bar // 2) % 2], lambda i: kick(50.0, 90.0, 0.03, 0.22, 0.35, 1.6), 0.8, kick=True)
            pattern(dr, bar, SNR[bar % 2], lambda i: snare(i % 3, 220, 0.12, 0.45, 3000, 0.55), 0.55, -0.05)
        pattern(hh, bar, "x-x-xox-x-x-xoxo", lambda i: hat(i % 4), 0.16, 0.25)
        if bar in (36, 92, 130):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 4, 1200, 9000), 0.45)
        if bar % 8 == 4:
            fx.add(tb(bar, 2), riser(1.0, 10 + bar % 5, 3000, 9000), 0.15, pan=0.6 if bar % 16 == 4 else -0.6)
    for b0, nb, seeds in ((40, 40, [91, 92, 93, 94]), (80, 16, [95, 96]), (96, 36, [91, 97, 93, 98])):
        for p in range(nb // 4):
            for bar, beat, m, d in E.phrase(seeds[p % len(seeds)], BL[p % 2], 79, 72, 88, CH, SC, bar0=b0 + 4 * p):
                bl.add(tb(bar, beat), bell(m, 1.2 + d * 0.4, 1.1, 2.0), 0.55, pan=0.3 if p % 2 else -0.3)
    return [dr, hh, bass, choir, bl, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
