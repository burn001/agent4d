#!/usr/bin/env python3
"""'마감 질주' — 흐름(Intense 코딩) 매우 활발(3단계) 배경음악.

핸즈업 하드 댄스: 뒷박 톱니 베이스, 3-3-2 리듬으로 찌르는 슈퍼소 화음, 밝은 사각파 리드, 포온더플로어 킥·클랩·라이드,
브레이크다운은 피아노 화음. 156 BPM 4/4 195마디 = 정확히 300초, Bb major(Bb–F–Gm–Eb). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 빌드업(16～48) → 드롭(48～96) → 브레이크다운(96～112) → 클라이맥스(112～176) → 아웃트로(176～195)

  python music/compose_deadline.py --out <폴더>/bgm-deadline.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import (Layer, tb, lv, prog_at, melody, pattern, voicing, scale_of, saw_note, pad_note, kick, clap, hat, riser,
                    bass_note)

E.setup("deadline", "마감 질주",
        "매우 활발 · 핸즈업 하드 댄스 — 뒷박 톱니 베이스, 3-3-2 슈퍼소 화음, 밝은 사각파 리드, 킥·클랩·라이드",
        "Bb major", 156, [
            {"n": "인트로", "part": "기", "bars": 16, "saw": 0.5, "bass": 0.6, "kick": 1.0, "clap": 0.0, "ride": 0.6, "lead": 0.0, "piano": 0.0, "fx": 0.0},
            {"n": "빌드업", "part": "승", "bars": 32, "saw": 0.8, "bass": 1.0, "kick": 1.0, "clap": 1.0, "ride": 0.9, "lead": 0.0, "piano": 0.0, "fx": 1.0},
            {"n": "드롭", "part": "전", "bars": 48, "saw": 1.0, "bass": 1.0, "kick": 1.0, "clap": 1.0, "ride": 1.0, "lead": 1.0, "piano": 0.0, "fx": 1.0},
            {"n": "브레이크다운", "part": "전", "bars": 16, "saw": 0.4, "bass": 0.0, "kick": 0.0, "clap": 0.0, "ride": 0.3, "lead": 0.6, "piano": 1.0, "fx": 1.0},
            {"n": "클라이맥스", "part": "전", "bars": 64, "saw": 1.0, "bass": 1.0, "kick": 1.0, "clap": 1.0, "ride": 1.0, "lead": 1.0, "piano": 0.4, "fx": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 19, "saw": 0.5, "bass": 0.6, "kick": 1.0, "clap": 0.0, "ride": 0.6, "lead": 0.0, "piano": 0.0, "fx": 0.0},
        ], stage=3, energy=0.95, reverb=(2.0, 1.5, 0.6), wet=0.25, echo_beats=0.75, master_lp=12000, hi_shelf=-4.5)

CH = prog_at(["Bb", "F", "Gm", "Eb"], per=2)
SC = scale_of(10, "major")
LEAD = [[(0, 3), (3, 3), (6, 2), (8, 2), (10, 2), (12, 4), (16, 3), (19, 3), (22, 2), (24, 4), (28, 4)],
        [(0, 2), (2, 2), (4, 2), (6, 2), (8, 3), (11, 3), (14, 2), (16, 6), (22, 2), (24, 8)]]
STAB = "x--x--x---x--x--"


def build():
    saw = Layer("saw", dry=0.5, rev=0.35, hp=250, lp=6000, width=1.5, tau=2.0, duck=0.55, gain=2.5)
    bass = Layer("bass", dry=1.0, rev=0.02, lp=1300, tau=1.0, duck=0.6)
    kk = Layer("kick", dry=1.0, rev=0.05, lp=5000, tau=0.5, gain=0.45)
    cl = Layer("clap", dry=0.65, rev=0.4, hp=600, tau=1.0, gain=3.0)
    ride = Layer("ride", dry=0.6, rev=0.15, hp=5000, tau=1.0, gain=2.0)
    lead = Layer("lead", dry=0.55, rev=0.35, echo=0.35, lp=6000, hp=400, tau=2.0, duck=0.2)
    pno = Layer("piano", dry=0.6, rev=0.5, lp=5500, hp=150, tau=2.0)
    fx = Layer("fx", dry=0.6, rev=0.5, hp=400, tau=1.0)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 62, 79, prev, maxn=4)
        prev = vo
        for i, c in enumerate(STAB):
            if c == "x":
                for m in vo:
                    saw.add(tb(bar, i / 4), pad_note(m, E.BEAT * 0.35, 0.004, 0.08, 7, 24, 1.0), 0.14)
        b = bass_note(ch, 34)
        for i in range(4):
            bass.add(tb(bar, i + 0.5), saw_note(b, E.BEAT * 0.42, 1600, 300, 0.05, 0.003, 0.03), 0.6)
        pattern(kk, bar, "X---X---X---X---", lambda i: kick(50.0, 120.0, 0.025, 0.22, 0.6, 2.0), 0.9, kick=True)
        pattern(cl, bar, "----X-------X---", lambda i: clap(bar % 4), 0.5)
        pattern(ride, bar, "x-x-x-x-x-x-x-x-", lambda i: hat(i % 4, True), 0.12, 0.25)
        if bar % 2 == 0:
            for j, m in enumerate(voicing(ch, 55, 72, None, maxn=4)):
                pno.note(tb(bar) + 0.01 * j, "piano", m, E.BAR * 1.8, 0.4)
        if bar in (44, 108, 172):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 4, 800, 8000), 0.5)
    melody(lead, "square", 48, 48, [51, 52, 53, 54], LEAD, CH, SC, 0.42, 0.0, lo=70, hi=87)
    melody(lead, "square", 96, 16, [55, 56], LEAD, CH, SC, 0.3, 0.0, lo=70, hi=87, legato=1.3)
    melody(lead, "square", 112, 64, [51, 57, 53, 58], LEAD, CH, SC, 0.44, 0.0, lo=72, hi=89)
    return [saw, bass, kk, cl, ride, lead, pno, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
