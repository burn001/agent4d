#!/usr/bin/env python3
"""'혜성 꼬리' — Planet(Cosmic Ambient) 보통(1단계) 배경음악.

3-3-2 리듬의 다운템포 코스믹: 8분 3-3-2 자리에 오는 부드러운 킥·서브, 칼림바 16분 아르페지오가 꼬리처럼 에코로 끌리고,
고조에서 플루트 선율, 넓은 패드. 92 BPM 4/4 115마디 = 정확히 300초, Bb lydian(Bbmaj9–C/Bb–Gm9–Ebmaj9).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) → 전개(12～44) → 고조(44～76) 플루트 → 브레이크(76～84) → 흐름(84～103) → 아웃트로(103～115)

  python music/compose_comet.py --out <폴더>/bgm-comet.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, melody, voicing, scale_of, kick, shaker, sub_note, bass_note, tone_hit

E.setup("comet", "혜성 꼬리",
        "보통 · 3-3-2 리듬 다운템포 코스믹 — 부드러운 킥·서브, 에코로 끌리는 칼림바 아르페지오, 플루트 선율, 넓은 패드",
        "Bb lydian", 92, [
            {"n": "인트로", "part": "기", "bars": 12, "kal": 0.7, "kick": 0.0, "sub": 0.5, "shk": 0.0, "flute": 0.0, "pad": 1.0, "filt": 0.25},
            {"n": "전개", "part": "승", "bars": 32, "kal": 1.0, "kick": 1.0, "sub": 1.0, "shk": 0.7, "flute": 0.0, "pad": 0.8, "filt": 0.45},
            {"n": "고조", "part": "전", "bars": 32, "kal": 0.9, "kick": 1.0, "sub": 1.0, "shk": 1.0, "flute": 1.0, "pad": 0.9, "filt": 0.75},
            {"n": "브레이크", "part": "전", "bars": 8, "kal": 0.8, "kick": 0.0, "sub": 0.5, "shk": 0.3, "flute": 0.6, "pad": 1.0, "filt": 0.4},
            {"n": "흐름", "part": "전", "bars": 19, "kal": 1.0, "kick": 1.0, "sub": 1.0, "shk": 0.9, "flute": 0.5, "pad": 0.8, "filt": 0.6},
            {"n": "아웃트로", "part": "결", "bars": 12, "kal": 0.7, "kick": 0.0, "sub": 0.5, "shk": 0.0, "flute": 0.0, "pad": 1.0, "filt": 0.25},
        ], stage=1, energy=0.36, reverb=(4.5, 3.6, 1.4), wet=0.5, echo_beats=0.75, echo_fb=0.55, master_lp=10500)

CH = prog_at(["Bbmaj9", "C/Bb", "Gm9", "Ebmaj9"], per=4)
SC = scale_of(10, "lydian")
FL = [[(0, 4), (4, 2), (6, 2), (8, 8), (16, 3), (19, 3), (22, 2), (24, 8)], [(2, 4), (6, 2), (8, 6), (14, 2), (16, 8), (26, 6)]]
TRI = [0, 1, 2, 0, 1, 2, 3, 2, 1, 3, 2, 1, 3, 4, 3, 2]  # 3-3-2… 묶음 아르페지오


def build():
    kal = Layer("kal", dry=0.5, rev=0.4, echo=0.6, lp=7000, hp=250, tau=2.5, duck=0.15, gain=0.6)
    kk = Layer("kick", dry=1.0, rev=0.08, lp=1500, tau=1.0)
    sub = Layer("sub", dry=1.0, lp=220, tau=2.0, duck=0.3)
    shk = Layer("shk", dry=0.6, rev=0.25, hp=4000, tau=2.0, gain=2.0)
    fl = Layer("flute", dry=0.5, rev=0.55, echo=0.3, lp=6500, hp=300, tau=3.0)
    pad = Layer("pad", dry=0.5, rev=0.6, hp=120, sweep=(500, 2800), width=1.4, tau=5.0)
    pads(pad, CH, 57, 72, every=4, v=0.14, a=2.5, rel=3.0, cents=10)
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 65, 84, None, maxn=5)
        for i in range(16):
            if i in (7, 15):
                continue
            kal.note(tb(bar, i / 4), "kalimba", vo[TRI[i] % len(vo)], 0.2, 0.42 if i in (0, 6, 12) else 0.28, pan=-0.4 + 0.8 * (i % 3) / 2)
        if lv("kick", bar) > 0:
            for bt, v in ((0, 0.6), (1.5, 0.42), (3.0, 0.5)):
                kk.kick(tb(bar, bt), kick(50.0, 55.0, 0.03, 0.22, 0.05, 1.3), v)
            kk.hit(tb(bar, 2), tone_hit(330.0, 0.08, 0.3, 0.01, ((1, 1.0), (1.6, 0.3)), 0.6, 2500, bar % 3), 0.18)
        b = bass_note(ch, 34)
        for bt, d in ((0, 1.4), (1.5, 1.4), (3.0, 0.9)):
            sub.add(tb(bar, bt), sub_note(b, E.BEAT * d, 0.01, 0.15, 0.1), 0.34)
        if lv("shk", bar) > 0:
            for i in range(8):
                shk.hit(tb(bar, i / 2 + 0.25), shaker(i % 4), 0.2 if i % 2 else 0.14, pan=0.3)
    melody(fl, "flute", 44, 32, [81, 82, 83, 84], FL, CH, SC, 0.5, -0.1, lo=70, hi=86)
    melody(fl, "flute", 76, 8, [85], FL, CH, SC, 0.4, -0.1, lo=70, hi=86)
    melody(fl, "flute", 88, 12, [82, 81, 86], FL, CH, SC, 0.42, -0.1, lo=70, hi=86)
    return [kal, kk, sub, shk, fl, pad]


if __name__ == "__main__":
    sys.exit(E.run(build))
