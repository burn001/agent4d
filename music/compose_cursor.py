#!/usr/bin/env python3
"""'깜빡이는 커서' — 흐름(Intense 코딩) 한가(0단계) 배경음악.

느린 덥 테크노: 뒷박 화음 스탭(닫힌 필터 톱니)이 3/8박 에코로 번지고, 바늘 잡음, 1·3박 여린 킥, 성긴 림, 서브 베이스.
76 BPM 4/4 95마디 = 정확히 300초, F# minor(F#m9 · Dmaj7 · C#m7 · Bm9, 4마디씩). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) 스탭·잡음 → 전개(12～40) 킥·서브 → 흐름(40～68) 림·필터 열림 → 정리(68～83) → 아웃트로(83～95)

  python music/compose_cursor.py --out <폴더>/bgm-cursor.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, voicing, saw_note, sub_note, kick, tone_hit, texture, hat, bass_note

E.setup("cursor", "깜빡이는 커서",
        "한가 · 느린 덥 테크노 — 뒷박 화음 스탭과 긴 에코, 바늘 잡음, 여린 킥, 서브 베이스",
        "F# minor", 76, [
            {"n": "인트로", "part": "기", "bars": 12, "stab": 0.8, "vinyl": 1.0, "kick": 0.0, "sub": 0.0, "rim": 0.0, "hat": 0.0, "pad": 0.7, "filt": 0.15},
            {"n": "전개", "part": "승", "bars": 28, "stab": 1.0, "vinyl": 0.8, "kick": 1.0, "sub": 1.0, "rim": 0.0, "hat": 0.5, "pad": 0.6, "filt": 0.35},
            {"n": "흐름", "part": "전", "bars": 28, "stab": 1.0, "vinyl": 0.8, "kick": 1.0, "sub": 1.0, "rim": 1.0, "hat": 1.0, "pad": 0.8, "filt": 0.65},
            {"n": "정리", "part": "전", "bars": 15, "stab": 0.9, "vinyl": 0.9, "kick": 0.6, "sub": 0.7, "rim": 0.4, "hat": 0.3, "pad": 0.8, "filt": 0.3},
            {"n": "아웃트로", "part": "결", "bars": 12, "stab": 0.8, "vinyl": 1.0, "kick": 0.0, "sub": 0.0, "rim": 0.0, "hat": 0.0, "pad": 0.7, "filt": 0.15},
        ], stage=0, energy=0.25, reverb=(4.0, 3.0, 1.0), wet=0.4, echo_beats=0.75, echo_fb=0.62, master_lp=9500)

CH = prog_at(["F#m9", "Dmaj7", "C#m7", "Bm9"], per=4)


def build():
    stab = Layer("stab", dry=0.55, rev=0.35, echo=0.75, hp=180, sweep=(700, 3200), width=1.1, tau=3.0, duck=0.3)
    vinyl = Layer("vinyl", dry=1.0, rev=0.0, hp=900, lp=7000, tau=4.0, gain=0.16)
    kk = Layer("kick", dry=1.0, rev=0.05, lp=1200, tau=1.0)
    sub = Layer("sub", dry=1.0, lp=180, tau=2.0, duck=0.35)
    rim = Layer("rim", dry=0.6, rev=0.3, echo=0.5, hp=400, tau=2.0, gain=4.0)
    hh = Layer("hat", dry=0.7, rev=0.15, hp=5000, tau=2.0, gain=3.0)
    pad = Layer("pad", dry=0.5, rev=0.6, hp=150, lp=2400, width=1.4, tau=5.0)
    vinyl.add(0.0, texture("vinyl", 1), 1.0)
    pads(pad, CH, 54, 69, every=4, v=0.12, a=3.0, rel=3.5, cents=14)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 57, 72, prev, rootless=False, maxn=4)
        prev = vo
        for bt in ((1.5,) if bar % 2 else (0.5, 2.5)):
            for m in vo:
                stab.add(tb(bar, bt), saw_note(m, 0.12, 2400, 500, 0.05, 0.002, 0.05), 0.33)
        if lv("kick", bar) > 0:
            for bt in (0, 2):
                kk.kick(tb(bar, bt), kick(48.0, 60.0, 0.03, 0.25, 0.0, 1.3), 0.5 if bt == 0 else 0.42)
        if lv("sub", bar) > 0:
            b = bass_note(ch, 30)
            sub.add(tb(bar, 0), sub_note(b, E.BEAT * 1.6, 0.01, 0.12, 0.15), 0.36)
            sub.add(tb(bar, 2.5), sub_note(b + (7 if bar % 4 == 3 else 0), E.BEAT * 1.2, 0.01, 0.12, 0.15), 0.3)
        if lv("rim", bar) > 0 and bar % 2 == 1:
            rim.hit(tb(bar, 3.5), tone_hit(820.0, 0.02, 0.0, 0.02, ((1, 1.0), (2.01, 0.5)), 0.4, 3000, bar % 3), 0.28, pan=0.3)
        if lv("hat", bar) > 0:
            for i in range(4):
                hh.hit(tb(bar, i + 0.5), hat(i % 4), 0.18, pan=-0.25)
    return [stab, vinyl, kk, sub, rim, hh, pad]


if __name__ == "__main__":
    sys.exit(E.run(build))
