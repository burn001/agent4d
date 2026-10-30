#!/usr/bin/env python3
"""'오후의 찻잔' — 복셀(카페·사무실) 한가(0단계) 배경음악.

느린 왈츠: 오르골 선율, 나일론 기타 '쿵·짝·짝' 반주, 1박 피치카토 베이스, B 구간 현악 화음과 클라리넷 대선율.
84 BPM 3/4 140마디 = 정확히 300초, A major(A–F#m7–Bm7–E7–A–D–Bm7–E7, 20마디 순환). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) → A(12～60) 오르골 → B(60～92) 현악·클라리넷 → A · 다시(92～128) → 아웃트로(128～140)

  python music/compose_teatime.py --out <폴더>/bgm-teatime.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, prog_at, melody, voicing, scale_of, bass_note

E.setup("teatime", "오후의 찻잔",
        "한가 · 느린 왈츠 — 오르골 선율, 나일론 기타 쿵·짝·짝, 피치카토 베이스, 현악 화음과 클라리넷 대선율",
        "A major", 84, [
            {"n": "인트로", "part": "기", "bars": 12, "gtr": 1.0, "box": 0.0, "pizz": 0.6, "str": 0.0, "clar": 0.0},
            {"n": "A", "part": "승", "bars": 48, "gtr": 1.0, "box": 1.0, "pizz": 1.0, "str": 0.0, "clar": 0.0},
            {"n": "B", "part": "전", "bars": 32, "gtr": 0.9, "box": 0.5, "pizz": 1.0, "str": 1.0, "clar": 1.0},
            {"n": "A · 다시", "part": "전", "bars": 36, "gtr": 1.0, "box": 1.0, "pizz": 1.0, "str": 0.4, "clar": 0.0},
            {"n": "아웃트로", "part": "결", "bars": 12, "gtr": 1.0, "box": 0.0, "pizz": 0.6, "str": 0.0, "clar": 0.0},
        ], stage=0, energy=0.2, beats=3, reverb=(2.6, 2.0, 0.8), wet=0.32, master_lp=9500, hi_shelf=-5.0)

CH = prog_at(["A", "A", "F#m7", "F#m7", "Bm7", "E7", "A", "D", "Bm7", "E7"], per=2)
SC = scale_of(9, "major")
BOX = [[(0, 2), (2, 1), (3, 1), (4, 2), (6, 4), (10, 2), (12, 2), (14, 1), (15, 1), (16, 2), (18, 6)],
       [(0, 3), (3, 1), (4, 2), (6, 2), (8, 2), (10, 2), (12, 4), (16, 2), (18, 6)]]
CL = [[(0, 6), (6, 3), (9, 3), (12, 6), (18, 6)], [(0, 4), (4, 2), (6, 6), (12, 3), (15, 3), (18, 6)]]


def build():
    gtr = Layer("gtr", dry=0.75, rev=0.3, lp=6000, hp=80, tau=2.0)
    box = Layer("box", dry=0.55, rev=0.45, echo=0.15, lp=8000, hp=400, tau=3.0)
    pz = Layer("pizz", dry=0.8, rev=0.3, lp=2500, hp=40, tau=2.0)
    st = Layer("str", dry=0.5, rev=0.55, lp=5000, hp=150, width=1.4, tau=4.0)
    cl = Layer("clar", dry=0.55, rev=0.45, lp=5000, hp=200, tau=3.0)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        b = bass_note(ch, 40)
        gtr.note(tb(bar), "nylon", b + (7 if bar % 2 else 0), E.BEAT * 1.0, 0.45, pan=-0.2)
        vo = voicing(ch, 57, 69, prev, rootless=True, maxn=3)
        prev = vo
        for bt in (1, 2):
            for j, m in enumerate(vo):
                gtr.note(tb(bar, bt) + 0.008 * j, "nylon", m, E.BEAT * 0.7, 0.26 if bt == 1 else 0.22, pan=-0.2)
        pz.note(tb(bar), "pizz", bass_note(ch, 33), E.BEAT * 0.8, 0.6)
        if bar % 2 == 0:
            for j, m in enumerate(voicing(ch, 62, 76, None, maxn=4)):
                st.note(tb(bar), "strings", m, 2 * E.BAR - 0.1, 0.24, pan=-0.4 + j * 0.27)
    melody(box, "musicbox", 12, 48, [301, 302, 303, 304], BOX, CH, SC, 0.45, 0.25, lo=76, hi=93, per=4)
    melody(box, "musicbox", 60, 32, [305, 306], BOX, CH, SC, 0.3, 0.25, lo=79, hi=95, per=4)
    melody(box, "musicbox", 92, 36, [301, 302, 303, 304], BOX, CH, SC, 0.45, 0.25, lo=76, hi=93, per=4)
    melody(cl, "clarinet", 60, 32, [311, 312, 313, 314], CL, CH, SC, 0.42, -0.25, lo=62, hi=77, per=4, legato=1.0)
    return [gtr, box, pz, st, cl]


if __name__ == "__main__":
    sys.exit(E.run(build))
