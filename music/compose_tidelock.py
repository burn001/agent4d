#!/usr/bin/env python3
"""'조석 고정'(Tidal Lock) — 흐름(Intense 코딩)·Planet(Cosmic Ambient) 공유 풀 보통(1단계) 배경음악.

6/8 흔들림: 필터 닫힌 톱니 플럭이 8분 6음으로 오르내리고, 'oo' 합창 패드, 점4분 서브 베이스, 1박 킥·4박 림, 셰이커,
선율 구간에 첼로. 156 BPM(8분음표) 6/8 130마디 = 정확히 300초, B dorian(Bm9–E9–Gmaj7–A6).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 전개(16～52) → 선율(52～92) 첼로 → 브레이크(92～102) → 흐름(102～118) → 아웃트로(118～130)

  python music/compose_tidelock.py --out <폴더>/bgm-tidelock.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, melody, voicing, scale_of, kick, shaker, sub_note, bass_note, saw_note, tone_hit, inst

E.setup("tidelock", "조석 고정",
        "보통 · 6/8 흔들림 — 8분 톱니 플럭 분산화음, 'oo' 합창 패드, 점4분 서브 베이스, 1박 킥·4박 림, 셰이커, 첼로 선율",
        "B dorian", 156, [
            {"n": "인트로", "part": "기", "bars": 16, "pluck": 0.7, "choir": 1.0, "sub": 0.5, "kick": 0.0, "shk": 0.0, "cello": 0.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 36, "pluck": 1.0, "choir": 0.8, "sub": 1.0, "kick": 1.0, "shk": 0.7, "cello": 0.0, "filt": 0.5},
            {"n": "선율", "part": "전", "bars": 40, "pluck": 0.9, "choir": 0.9, "sub": 1.0, "kick": 1.0, "shk": 1.0, "cello": 1.0, "filt": 0.75},
            {"n": "브레이크", "part": "전", "bars": 10, "pluck": 0.8, "choir": 1.0, "sub": 0.5, "kick": 0.0, "shk": 0.3, "cello": 0.6, "filt": 0.4},
            {"n": "흐름", "part": "결", "bars": 16, "pluck": 1.0, "choir": 0.8, "sub": 1.0, "kick": 1.0, "shk": 0.9, "cello": 0.4, "filt": 0.6},
            {"n": "아웃트로", "part": "결", "bars": 12, "pluck": 0.7, "choir": 1.0, "sub": 0.5, "kick": 0.0, "shk": 0.0, "cello": 0.0, "filt": 0.3},
        ], stage=1, energy=0.4, beats=6, reverb=(3.6, 2.8, 1.1), wet=0.42, echo_beats=3.0, echo_fb=0.4, master_lp=10500)

CH = prog_at(["Bm9", "E9", "Gmaj7", "A6"], per=2)
SC = scale_of(11, "dorian")
SHAPE = [0, 2, 3, 4, 3, 2]  # 6/8 한 마디: 근음 → 위 → 꼭대기 → 내려옴
CE = [[(0, 3), (3, 2), (5, 1), (6, 6), (12, 4), (16, 2), (18, 6)], [(0, 6), (6, 3), (9, 3), (12, 2), (14, 4), (18, 6)]]


def build():
    pl = Layer("pluck", dry=0.6, rev=0.35, echo=0.35, hp=200, sweep=(700, 5200), tau=2.0, duck=0.2, width=1.2, gain=1.6)
    ch_ = Layer("choir", dry=0.45, rev=0.65, hp=150, lp=4500, width=1.5, tau=5.0)
    kk = Layer("kick", dry=1.0, rev=0.08, lp=1400, tau=1.0)
    sub = Layer("sub", dry=1.0, lp=220, tau=2.0, duck=0.3)
    shk = Layer("shk", dry=0.6, rev=0.25, hp=4200, tau=2.0, gain=2.0)
    ce = Layer("cello", dry=0.55, rev=0.5, lp=3200, hp=60, tau=3.0)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 59, 79, None, maxn=5)
        for i in range(6):
            m = vo[SHAPE[i] % len(vo)]
            pl.add(tb(bar, i), saw_note(m, round(E.BEAT * 0.8, 3), 2400, 700, 0.08, 0.004, 0.06), 0.3 if i in (0, 3) else 0.22,
                   -0.3 + 0.12 * i)
        if bar % 2 == 0:
            cv = voicing(ch, 55, 71, prev, rootless=True, maxn=4)
            prev = cv
            for j, m in enumerate(cv):
                ch_.add(tb(bar), inst("choir", m, 2 * E.BAR - 0.2, 0.2), 1.0, -0.4 + 0.27 * j)
        b = bass_note(ch, 35)
        if lv("sub", bar) > 0:
            sub.add(tb(bar), sub_note(b, E.BEAT * 2.8, 0.01, 0.12, 0.1), 0.36)
            sub.add(tb(bar, 3), sub_note(b + (7 if bar % 2 else 0), E.BEAT * 2.6, 0.01, 0.12, 0.1), 0.3)
        if lv("kick", bar) > 0:
            kk.kick(tb(bar), kick(48.0, 60.0, 0.03, 0.24, 0.05, 1.3), 0.6)
            if bar % 4 == 3:
                kk.kick(tb(bar, 5), kick(48.0, 60.0, 0.03, 0.24, 0.05, 1.3), 0.32)
            kk.hit(tb(bar, 3), tone_hit(1600.0, 0.03, 0.4, 0.004, ((1.0, 1.0), (2.4, 0.4)), 0.4, 3000, bar % 3), 0.2)
        if lv("shk", bar) > 0:
            for i in range(6):
                shk.hit(tb(bar, i + 0.5), shaker(i % 4), 0.14, pan=0.3)
                shk.hit(tb(bar, i), shaker((i + 2) % 4), 0.2 if i in (0, 3) else 0.11, pan=0.3)
    melody(ce, "cello", 52, 40, [401, 402, 403, 404, 405], CE, CH, SC, 0.42, -0.2, lo=47, hi=64, slot_beats=1.0, legato=1.0,
           leaps=(-3, -2, -1, 1, 2, 3))
    melody(ce, "cello", 92, 8, [406, 407], CE, CH, SC, 0.32, -0.2, lo=47, hi=64, slot_beats=1.0, legato=1.0)
    melody(ce, "cello", 104, 12, [401, 402, 403], CE, CH, SC, 0.3, -0.2, lo=47, hi=64, slot_beats=1.0, legato=1.0)
    return [pl, ch_, kk, sub, shk, ce]


if __name__ == "__main__":
    sys.exit(E.run(build))
