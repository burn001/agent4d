#!/usr/bin/env python3
"""'빌드 대기열' — 흐름(Intense 코딩) 보통(1단계) 배경음악.

3/4 미니멀 폴리미터: 16분 마림바 오스티나토가 5음 주기로 돌아 마디마다 자리를 바꾸고, 칼림바 8분 7음 주기가 엇갈린다.
1박 여린 킥, 8분 셰이커, 서브 베이스, 넓은 패드. 105 BPM 3/4 175마디 = 정확히 300초, Bb minor(Bbm9–Gbmaj7–Dbmaj9–Fm7).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) 마림바 → 전개(16～64) 킥·서브 → 고조(64～112) 칼림바·필터 → 브레이크(112～127) → 흐름(127～159) → 아웃트로(159～175)

  python music/compose_queue.py --out <폴더>/bgm-queue.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, voicing, kick, shaker, sub_note, bass_note

E.setup("queue", "빌드 대기열",
        "보통 · 3/4 미니멀 폴리미터 — 5음 주기 16분 마림바, 7음 주기 칼림바, 여린 킥·셰이커, 서브 베이스, 넓은 패드",
        "Bb minor", 105, [
            {"n": "인트로", "part": "기", "bars": 16, "mar": 0.8, "kal": 0.0, "kick": 0.0, "shk": 0.0, "sub": 0.0, "pad": 0.8, "filt": 0.25},
            {"n": "전개", "part": "승", "bars": 48, "mar": 1.0, "kal": 0.0, "kick": 1.0, "shk": 0.7, "sub": 1.0, "pad": 0.7, "filt": 0.45},
            {"n": "고조", "part": "전", "bars": 48, "mar": 1.0, "kal": 1.0, "kick": 1.0, "shk": 1.0, "sub": 1.0, "pad": 0.9, "filt": 0.8},
            {"n": "브레이크", "part": "전", "bars": 15, "mar": 0.8, "kal": 0.8, "kick": 0.0, "shk": 0.3, "sub": 0.5, "pad": 1.0, "filt": 0.4},
            {"n": "흐름", "part": "전", "bars": 32, "mar": 1.0, "kal": 0.6, "kick": 1.0, "shk": 1.0, "sub": 1.0, "pad": 0.8, "filt": 0.65},
            {"n": "아웃트로", "part": "결", "bars": 16, "mar": 0.8, "kal": 0.0, "kick": 0.0, "shk": 0.0, "sub": 0.0, "pad": 0.8, "filt": 0.25},
        ], stage=1, energy=0.48, beats=3, reverb=(3.2, 2.4, 0.9), wet=0.35, echo_beats=1.5, master_lp=10000)

CH = prog_at(["Bbm9", "Gbmaj7", "Dbmaj9", "Fm7"], per=4)


def build():
    mar = Layer("mar", dry=0.75, rev=0.3, lp=6000, hp=150, tau=2.0, duck=0.15, gain=0.6)
    kal = Layer("kal", dry=0.55, rev=0.35, echo=0.35, lp=6500, hp=300, tau=3.0)
    kk = Layer("kick", dry=1.0, rev=0.05, lp=1200, tau=1.0)
    shk = Layer("shk", dry=0.7, rev=0.15, hp=4000, tau=2.0)
    sub = Layer("sub", dry=1.0, lp=200, tau=2.0, duck=0.3)
    pad = Layer("pad", dry=0.5, rev=0.6, hp=140, sweep=(600, 3000), width=1.4, tau=5.0)
    pads(pad, CH, 58, 73, every=4, v=0.14, a=2.5, rel=3.0, cents=12)
    k5, k7 = 0, 0
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 63, 77, prev, maxn=4)
        prev = vo
        seq5 = [vo[0], vo[2 % len(vo)], vo[1], vo[-1], vo[2 % len(vo)]]
        for i in range(12):
            mar.note(tb(bar, i / 4), "marimba", seq5[k5 % 5], 0.2, 0.5 if i % 4 == 0 else 0.34, pan=-0.2 + 0.4 * ((k5 % 5) / 4))
            k5 += 1
        top = voicing(ch, 72, 86, None, maxn=4)
        seq7 = [top[0], top[1 % len(top)], top[-1], top[1 % len(top)], top[2 % len(top)], top[0] + 12 if top[0] + 12 <= 88 else top[0], top[-1]]
        for i in range(6):
            if (k7 % 7) in (3, 6):
                k7 += 1
                continue
            kal.note(tb(bar, i / 2), "kalimba", seq7[k7 % 7], 0.2, 0.45, pan=0.35)
            k7 += 1
        if lv("kick", bar) > 0:
            kk.kick(tb(bar), kick(47.0, 65.0, 0.03, 0.26, 0.1, 1.3), 0.55)
            if bar % 4 == 3:
                kk.kick(tb(bar, 2.5), kick(47.0, 65.0, 0.03, 0.26, 0.1, 1.3), 0.3)
        if lv("shk", bar) > 0:
            for i in range(6):
                shk.hit(tb(bar, i / 2), shaker(i % 4), 0.28 if i % 2 else 0.18, pan=0.2)
        if lv("sub", bar) > 0 and bar % 2 == 0:
            sub.add(tb(bar), sub_note(bass_note(ch, 32), 2 * E.BAR - 0.15, 0.02, 0.2, 0.12), 0.3)
    return [mar, kal, kk, shk, sub, pad]


if __name__ == "__main__":
    sys.exit(E.run(build))
