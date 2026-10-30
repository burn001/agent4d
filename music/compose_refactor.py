#!/usr/bin/env python3
"""'리팩터 루프' — 흐름(Intense 코딩) 보통(1단계) 배경음악.

트립합: 먼지 낀 브레이크비트(살짝 스윙), 바늘 잡음, 깊은 핑거 베이스, 펠트 피아노 단조 화음, 현악 패드, 성긴 비브라폰 선율.
88 BPM 4/4 110마디 = 정확히 300초, G# minor(G#m9–Emaj7–C#m9–D#7b9). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～8) → A(8～40) 비트·베이스·피아노 → B(40～72) 현악·비브라폰 선율 → A · 다시(72～102) → 아웃트로(102～110)

  python music/compose_refactor.py --out <폴더>/bgm-refactor.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, melody, pattern, voicing, scale_of, kick, snare, hat, texture, bass_note

E.setup("refactor", "리팩터 루프",
        "보통 · 트립합 — 먼지 낀 브레이크비트, 깊은 핑거 베이스, 펠트 피아노 단조 화음, 현악 패드, 비브라폰 선율",
        "G# minor", 88, [
            {"n": "인트로", "part": "기", "bars": 8, "drums": 0.0, "bass": 0.0, "piano": 1.0, "str": 0.5, "vib": 0.0, "vinyl": 1.0},
            {"n": "A", "part": "승", "bars": 32, "drums": 1.0, "bass": 1.0, "piano": 1.0, "str": 0.4, "vib": 0.0, "vinyl": 0.7},
            {"n": "B", "part": "전", "bars": 32, "drums": 1.0, "bass": 1.0, "piano": 0.7, "str": 1.0, "vib": 1.0, "vinyl": 0.7},
            {"n": "A · 다시", "part": "전", "bars": 30, "drums": 1.0, "bass": 1.0, "piano": 1.0, "str": 0.6, "vib": 0.5, "vinyl": 0.7},
            {"n": "아웃트로", "part": "결", "bars": 8, "drums": 0.0, "bass": 0.0, "piano": 1.0, "str": 0.5, "vib": 0.0, "vinyl": 1.0},
        ], stage=1, energy=0.38, reverb=(2.4, 1.8, 0.7), wet=0.3, master_lp=9000, hi_shelf=-5.0)

CH = prog_at(["G#m9", "G#m9", "Emaj7", "Emaj7", "C#m9", "C#m9", "D#7sus", "D#7b9"], per=2)
SC = scale_of(8, "minor")
SLOTS = [[(0, 3), (3, 1), (4, 4), (10, 2), (12, 4), (16, 6), (24, 8)], [(2, 2), (4, 6), (12, 2), (14, 2), (16, 4), (20, 12)]]
KICK = ["X-----x---X--x--", "X-----x--x-X----"]
SNR = ["----X-.-..--X--o", "----X--.-.--X-.x"]
HAT = "x-o-x-o-x-ooX-o-"


def build():
    dr = Layer("drums", dry=0.9, rev=0.15, lp=7000, hp=40, tau=1.5, drive=0.4)
    bass = Layer("bass", dry=1.0, rev=0.03, lp=900, tau=1.5, duck=0.25, gain=0.45)
    pno = Layer("piano", dry=0.75, rev=0.35, lp=5000, hp=120, tau=2.0, gain=0.6)
    st = Layer("str", dry=0.5, rev=0.55, lp=4500, hp=200, width=1.4, tau=4.0)
    vib = Layer("vib", dry=0.55, rev=0.45, echo=0.25, lp=6000, hp=300, tau=3.0, gain=1.6)
    vinyl = Layer("vinyl", dry=1.0, hp=1200, lp=6500, tau=3.0, gain=0.18)
    vinyl.add(0.0, texture("vinyl", 3), 1.0)
    pads(st, CH, 60, 76, every=2, v=0.12, a=1.8, rel=2.5, voices=4, cents=9)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 55, 70, prev, rootless=True)
        prev = vo
        for bt, vel in (((0, 0.42), (2.5, 0.3)) if bar % 2 == 0 else ((0.5, 0.32), (3, 0.36))):
            for i, m in enumerate(vo):
                pno.note(tb(bar, bt) + 0.012 * i, "felt", m, E.BEAT * 1.6, vel)
        if lv("drums", bar) > 0:
            pattern(dr, bar, KICK[bar % 2], lambda i: kick(52.0, 70.0, 0.025, 0.2, 0.25, 1.6), 0.7, kick=True, swing=0.12)
            pattern(dr, bar, SNR[(bar // 4) % 2], lambda i: snare(i % 3, 210, 0.13, 0.5, 2600, 0.5), 0.5, 0.1, swing=0.12)
            pattern(dr, bar, HAT, lambda i: hat(i % 4), 0.16, -0.2, swing=0.12)
        if lv("bass", bar) > 0:
            b = bass_note(ch, 32)
            for bt, d, off in ((0, 1.4, 0), (1.75, 0.4, 0), (2.5, 1.0, 7 if bar % 2 else 0), (3.5, 0.4, 12)):
                bass.note(tb(bar, bt + 0.03), "ebass", b + off, E.BEAT * d, 0.7)
    melody(vib, "vibes", 40, 32, [31, 32, 33, 34], SLOTS, CH, SC, 0.42, pan=0.25, lo=66, hi=82)
    melody(vib, "vibes", 80, 16, [33, 31], SLOTS, CH, SC, 0.38, pan=0.25, lo=66, hi=82)
    return [dr, bass, pno, st, vib, vinyl]


if __name__ == "__main__":
    sys.exit(E.run(build))
