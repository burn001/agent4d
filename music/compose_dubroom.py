#!/usr/bin/env python3
"""'서버실 더브'(Server Room Dub) — 흐름(Intense 코딩)·Planet(Cosmic Ambient) 공유 풀 보통(1단계) 배경음악.

느린 더브: 한 박 늦게 떨어지는 원드롭 킥과 크로스스틱, 길게 메아리치는 오프비트 기타 스탭, 둥근 서브 베이스 선율,
테이프 쉿·바늘 잡음, 선율 구간에 아코디언(멜로디카 같은) 주제. 76 BPM 4/4 95마디 = 정확히 300초,
F minor(Fm9–Fm9–Bbm9–Cm7). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～8) → 전개(8～32) → 선율(32～56) → 더브(56～71) 메아리 → 다시(71～87) → 아웃트로(87～95)

  python music/compose_dubroom.py --out <폴더>/bgm-dubroom.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, melody, voicing, scale_of, kick, hat, sub_note, bass_note, tone_hit, texture

E.setup("dubroom", "서버실 더브",
        "보통 · 느린 더브 — 원드롭 킥과 크로스스틱, 길게 메아리치는 오프비트 기타 스탭, 서브 베이스 선율, 테이프 잡음, 아코디언 주제",
        "F minor", 76, [
            {"n": "인트로", "part": "기", "bars": 8, "skank": 0.7, "drum": 0.0, "hat": 0.0, "sub": 0.5, "mel": 0.0, "tape": 1.0},
            {"n": "전개", "part": "승", "bars": 24, "skank": 1.0, "drum": 1.0, "hat": 0.7, "sub": 1.0, "mel": 0.0, "tape": 0.8},
            {"n": "선율", "part": "전", "bars": 24, "skank": 0.9, "drum": 1.0, "hat": 1.0, "sub": 1.0, "mel": 1.0, "tape": 0.8},
            {"n": "더브", "part": "전", "bars": 15, "skank": 1.0, "drum": 0.5, "hat": 0.3, "sub": 0.7, "mel": 0.4, "tape": 1.0},
            {"n": "다시", "part": "결", "bars": 16, "skank": 1.0, "drum": 1.0, "hat": 1.0, "sub": 1.0, "mel": 0.6, "tape": 0.8},
            {"n": "아웃트로", "part": "결", "bars": 8, "skank": 0.7, "drum": 0.0, "hat": 0.0, "sub": 0.5, "mel": 0.0, "tape": 1.0},
        ], stage=1, energy=0.38, reverb=(2.8, 2.0, 0.8), wet=0.34, echo_beats=0.75, echo_fb=0.6, master_lp=9500, hi_shelf=-4.0)

CH = prog_at(["Fm9", "Fm9", "Bbm9", "Cm7"], per=2)
SC = scale_of(5, "minor")
BL = [(0.0, 0, 1.4), (1.5, 7, 0.4), (2.0, 10, 0.9), (3.0, 12, 0.4), (3.5, 10, 0.4)]  # (박, 근음 위 반음, 길이 박)
ML = [[(0, 4), (4, 2), (6, 2), (8, 8), (16, 2), (18, 2), (20, 4), (24, 8)], [(2, 2), (4, 4), (8, 6), (14, 2), (16, 8), (26, 6)]]


def build():
    sk = Layer("skank", dry=0.5, rev=0.3, echo=0.65, lp=4200, hp=300, tau=2.0, width=1.3, gain=0.9)
    dr = Layer("drum", dry=1.0, rev=0.15, lp=3000, tau=1.0)
    hh = Layer("hat", dry=0.5, rev=0.2, hp=6500, tau=1.5, gain=2.0)
    sub = Layer("sub", dry=1.0, lp=240, tau=2.0, duck=0.25)
    ml = Layer("mel", dry=0.5, rev=0.4, echo=0.45, lp=4500, hp=250, tau=3.0)
    tp = Layer("tape", dry=1.0, rev=0.1, hp=500, lp=8000, width=1.3, tau=5.0, gain=0.045)
    tp.add(0.0, texture("vinyl", 11), 1.0)
    tp.add(0.0, texture("hiss", 12) * 0.5, 1.0)
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 60, 74, None, rootless=True, maxn=3)
        for bt in (1.0, 3.0):
            for j, m in enumerate(vo):
                sk.note(tb(bar, bt) + 0.006 * j, "skank", m, E.BEAT * 0.25, 0.34, pan=0.25)
        if lv("drum", bar) > 0:
            dr.kick(tb(bar, 2), kick(46.0, 55.0, 0.035, 0.3, 0.05, 1.3), 0.66)
            dr.hit(tb(bar, 2), tone_hit(1500.0, 0.035, 0.35, 0.004, ((1.0, 1.0), (2.3, 0.45)), 0.45, 3200, bar % 3), 0.24, -0.1)
            if bar % 4 == 3:
                dr.hit(tb(bar, 3.75), tone_hit(1500.0, 0.035, 0.35, 0.004, ((1.0, 1.0), (2.3, 0.45)), 0.45, 3200, 1), 0.14, -0.1)
        if lv("hat", bar) > 0:
            for i in range(8):
                hh.hit(tb(bar, i / 2 + (0.08 if i % 2 else 0.0)), hat(i % 4), 0.12 if i % 2 else 0.07, pan=-0.25)
        b = bass_note(ch, 29)
        for bt, iv, d in BL:
            sub.add(tb(bar, bt), sub_note(b + iv, E.BEAT * d, 0.008, 0.1, 0.15, 1.5), 0.36)
    melody(ml, "accordion", 32, 24, [601, 602, 603], ML, CH, SC, 0.36, -0.15, lo=65, hi=82)
    melody(ml, "accordion", 56, 12, [604, 605], ML, CH, SC, 0.26, -0.15, lo=65, hi=82)
    melody(ml, "accordion", 72, 12, [601, 602, 603], ML, CH, SC, 0.3, -0.15, lo=65, hi=82)
    return [sk, dr, hh, sub, ml, tp]


if __name__ == "__main__":
    sys.exit(E.run(build))
