#!/usr/bin/env python3
"""'심우주 관측' — Planet(Cosmic Ambient) 한가(0단계) 배경음악.

3/4 박의 느린 우주 관측: 긴 에코로 퍼지는 소나 핑, 성긴 펠트 피아노 단음 선율, 첼로 근음·5도 지속음, 낮은 패드, 테이프 쉿 소리.
비트 없음. 66 BPM 3/4 110마디 = 정확히 300초, C# minor(C#m9–Amaj7–F#m9–G#7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～14) → 전개(14～46) 피아노 → 흐름(46～78) 첼로·핑 촘촘 → 잦아듦(78～96) → 아웃트로(96～110)

  python music/compose_deepfield.py --out <폴더>/bgm-deepfield.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, prog_at, pads, melody, scale_of, bass_note, texture, inst

E.setup("deepfield", "심우주 관측",
        "한가 · 3/4 우주 관측 앰비언트 — 긴 에코의 소나 핑, 성긴 펠트 피아노, 첼로 지속음, 낮은 패드, 테이프 쉿",
        "C# minor", 66, [
            {"n": "인트로", "part": "기", "bars": 14, "ping": 0.7, "piano": 0.0, "cello": 0.5, "pad": 1.0, "hiss": 1.0, "filt": 0.2},
            {"n": "전개", "part": "승", "bars": 32, "ping": 0.8, "piano": 1.0, "cello": 0.7, "pad": 0.9, "hiss": 0.8, "filt": 0.4},
            {"n": "흐름", "part": "전", "bars": 32, "ping": 1.0, "piano": 0.9, "cello": 1.0, "pad": 0.8, "hiss": 0.8, "filt": 0.6},
            {"n": "잦아듦", "part": "전", "bars": 18, "ping": 0.8, "piano": 0.6, "cello": 0.8, "pad": 1.0, "hiss": 0.9, "filt": 0.35},
            {"n": "아웃트로", "part": "결", "bars": 14, "ping": 0.7, "piano": 0.0, "cello": 0.5, "pad": 1.0, "hiss": 1.0, "filt": 0.2},
        ], stage=0, energy=0.14, beats=3, reverb=(6.0, 5.0, 2.0), wet=0.6, echo_beats=1.5, echo_fb=0.6, master_lp=9000)

CH = prog_at(["C#m9", "Amaj7", "F#m9", "G#7sus"], per=4)
SC = scale_of(1, "minor")
SLOTS = [[(0, 4), (6, 2), (8, 4), (12, 6), (20, 4)], [(2, 4), (6, 6), (14, 4), (18, 6)]]


def build():
    ping = Layer("ping", dry=0.35, rev=0.6, echo=0.8, hp=800, lp=7000, tau=3.0, gain=2.0)
    pno = Layer("piano", dry=0.6, rev=0.6, echo=0.15, lp=4500, hp=150, tau=3.0)
    cello = Layer("cello", dry=0.55, rev=0.5, lp=3000, hp=50, tau=4.0, gain=0.5)
    pad = Layer("pad", dry=0.5, rev=0.6, hp=80, sweep=(350, 1800), width=1.4, tau=6.0)
    hiss = Layer("hiss", dry=1.0, hp=3000, lp=9000, tau=5.0, gain=0.07)
    hiss.add(0.0, texture("hiss", 4), 1.0)
    pads(pad, CH, 49, 64, every=4, v=0.15, a=3.5, rel=4.0, voices=5, cents=9)
    for bar in range(0, E.BARS, 2):
        b = bass_note(CH(bar), 36)
        span = min(2, E.BARS - bar)
        cello.note(tb(bar), "cello", b + (7 if (bar // 2) % 2 else 0), span * E.BAR - 0.1, 0.42, pan=-0.2)
    for bar in range(0, E.BARS, 2):
        m = 88 if (bar // 2) % 3 else 93
        ping.add(tb(bar, 1 if bar % 4 else 0), inst("blip", m, 0.05, 0.5), 1.0, pan=0.6 if bar % 4 else -0.6)
    melody(pno, "felt", 14, 80, [61, 62, 63, 64, 65], SLOTS, CH, SC, 0.5, 0.15, lo=61, hi=80, legato=1.8, per=4)
    return [ping, pno, cello, pad, hiss]


if __name__ == "__main__":
    sys.exit(E.run(build))
