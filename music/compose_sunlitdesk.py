#!/usr/bin/env python3
"""'햇살 드는 자리'(Sunlit Desk) — 복셀(카페·사무실) 보통(1단계) 배경음악.

어쿠스틱 핑거피킹: 스틸 기타 트래비스 주법(엄지 교대 베이스 + 엇박 고음), 여린 킥·림·16분 셰이커, 일렉트릭 베이스,
실로폰 주제, B 구간 현악 화음. 100 BPM 4/4 125마디 = 정확히 300초, C major(Cmaj7–Am7–Fmaj7–G6).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) → A(12～46) 실로폰 → B(46～78) 현악 → A · 다시(78～113) → 아웃트로(113～125)

  python music/compose_sunlitdesk.py --out <폴더>/bgm-sunlitdesk.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, melody, voicing, scale_of, kick, shaker, bass_note, tone_hit

E.setup("sunlitdesk", "햇살 드는 자리",
        "보통 · 어쿠스틱 핑거피킹 — 스틸 기타 트래비스 주법, 여린 킥·림·셰이커, 일렉트릭 베이스, 실로폰 주제, 현악 화음",
        "C major", 100, [
            {"n": "인트로", "part": "기", "bars": 12, "gtr": 1.0, "drums": 0.0, "shk": 0.5, "bass": 0.5, "xylo": 0.0, "str": 0.0},
            {"n": "A", "part": "승", "bars": 34, "gtr": 1.0, "drums": 1.0, "shk": 1.0, "bass": 1.0, "xylo": 1.0, "str": 0.0},
            {"n": "B", "part": "전", "bars": 32, "gtr": 0.9, "drums": 1.0, "shk": 1.0, "bass": 1.0, "xylo": 0.4, "str": 1.0},
            {"n": "A · 다시", "part": "전", "bars": 35, "gtr": 1.0, "drums": 1.0, "shk": 1.0, "bass": 1.0, "xylo": 1.0, "str": 0.3},
            {"n": "아웃트로", "part": "결", "bars": 12, "gtr": 1.0, "drums": 0.0, "shk": 0.5, "bass": 0.5, "xylo": 0.0, "str": 0.0},
        ], stage=1, energy=0.36, reverb=(2.0, 1.5, 0.6), wet=0.26, master_lp=10500, hi_shelf=-4.0)

CH = prog_at(["Cmaj7", "Am7", "Fmaj7", "G6"], per=2)
SC = scale_of(0, "major")
XY = [[(0, 2), (2, 2), (4, 4), (8, 2), (10, 1), (11, 1), (12, 4), (16, 3), (19, 1), (20, 4), (24, 8)],
      [(1, 1), (2, 2), (4, 2), (6, 2), (8, 6), (16, 2), (18, 2), (20, 2), (22, 2), (24, 8)]]


def build():
    gtr = Layer("gtr", dry=0.75, rev=0.28, lp=7000, hp=70, tau=2.0)
    dr = Layer("drums", dry=0.9, rev=0.15, lp=6000, tau=1.0)
    shk = Layer("shk", dry=0.6, rev=0.2, hp=4500, tau=2.0, gain=1.8)
    bs = Layer("bass", dry=0.9, rev=0.1, lp=1800, hp=35, tau=2.0, duck=0.2)
    xy = Layer("xylo", dry=0.6, rev=0.35, lp=7500, hp=300, tau=2.5, gain=0.7)
    st = Layer("str", dry=0.5, rev=0.55, lp=5000, hp=150, width=1.4, tau=4.0)
    for bar in range(E.BARS):
        ch = CH(bar)
        r = bass_note(ch, 40)
        up = voicing(ch, 60, 76, None, rootless=True, maxn=3)
        thumb = [r, r + 7, r + 12 if r + 12 <= 55 else r, r + 7]
        for k in range(4):  # 엄지: 4분 교대 베이스
            gtr.note(tb(bar, k), "steel", thumb[k], E.BEAT * 0.9, 0.36, pan=-0.25)
        for k, m in zip((0.5, 1.5, 2.0, 2.5, 3.5), (up[-1], up[1 % len(up)], up[0], up[-1], up[1 % len(up)])):  # 손가락: 엇박
            gtr.note(tb(bar, k), "steel", m, E.BEAT * 0.8, 0.24, pan=-0.1)
        if lv("drums", bar) > 0:
            dr.kick(tb(bar), kick(52.0, 50.0, 0.03, 0.2, 0.05, 1.2), 0.42)
            dr.kick(tb(bar, 2.5), kick(52.0, 50.0, 0.03, 0.2, 0.05, 1.2), 0.3)
            for bt in (1, 3):
                dr.hit(tb(bar, bt), tone_hit(1800.0, 0.03, 0.4, 0.004, ((1.0, 1.0), (2.4, 0.4)), 0.4, 3000, bar % 3), 0.2, 0.1)
        if lv("shk", bar) > 0:
            for i in range(16):
                shk.hit(tb(bar, i / 4), shaker(i % 4), 0.16 if i % 4 == 2 else 0.08, pan=0.35)
        bs.note(tb(bar), "ebass", bass_note(ch, 28), E.BEAT * 1.6, 0.48)
        bs.note(tb(bar, 2.5), "ebass", bass_note(ch, 28) + 7, E.BEAT * 1.2, 0.38)
        if bar % 2 == 0:
            for j, m in enumerate(voicing(ch, 60, 76, None, maxn=4)):
                st.note(tb(bar), "strings", m, 2 * E.BAR - 0.1, 0.22, pan=-0.4 + j * 0.27)
    melody(xy, "xylo", 12, 32, [801, 802, 803, 804], XY, CH, SC, 0.4, 0.2, lo=72, hi=88)
    melody(xy, "xylo", 48, 28, [805, 806], XY, CH, SC, 0.22, 0.2, lo=74, hi=88)
    melody(xy, "xylo", 80, 32, [801, 802, 803, 804], XY, CH, SC, 0.4, 0.2, lo=72, hi=88)
    return [gtr, dr, shk, bs, xy, st]


if __name__ == "__main__":
    sys.exit(E.run(build))
