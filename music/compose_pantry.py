#!/usr/bin/env python3
"""'탕비실 대소동' — 복셀(카페·사무실) 매우 활발(3단계) 배경음악.

정신없는 폴카·발칸풍 소동: 1·3박 튜바 '쿵'과 2·4박 아코디언 '짝', 화성단음계로 내달리는 8분 클라리넷, B 구간 실로폰 응수,
행진 스네어(마디 끝 롤)·킥·탬버린. 176 BPM 4/4 220마디 = 정확히 300초, D harmonic minor(Dm–A7–Dm–Gm–Dm–A7–Bb–A7).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → A(16～64) 클라리넷 → B(64～112) 실로폰·아코디언 → 브레이크(112～128) → A · 다시(128～200) → 아웃트로(200～220)

  python music/compose_pantry.py --out <폴더>/bgm-pantry.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pattern, voicing, scale_of, bass_note, kick, snare, shaker, phrase

E.setup("pantry", "탕비실 대소동",
        "매우 활발 · 폴카·발칸풍 소동 — 튜바 쿵·아코디언 짝, 화성단음계로 내달리는 클라리넷, 실로폰 응수, 행진 스네어·탬버린",
        "D harmonic minor", 176, [
            {"n": "인트로", "part": "기", "bars": 16, "tuba": 1.0, "acc": 1.0, "clar": 0.0, "xylo": 0.0, "drums": 0.8, "tamb": 0.6},
            {"n": "A", "part": "승", "bars": 48, "tuba": 1.0, "acc": 1.0, "clar": 1.0, "xylo": 0.0, "drums": 1.0, "tamb": 1.0},
            {"n": "B", "part": "전", "bars": 48, "tuba": 1.0, "acc": 1.0, "clar": 0.4, "xylo": 1.0, "drums": 1.0, "tamb": 1.0},
            {"n": "브레이크", "part": "전", "bars": 16, "tuba": 0.6, "acc": 1.0, "clar": 0.8, "xylo": 0.4, "drums": 0.2, "tamb": 0.5},
            {"n": "A · 다시", "part": "전", "bars": 72, "tuba": 1.0, "acc": 1.0, "clar": 1.0, "xylo": 0.6, "drums": 1.0, "tamb": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 20, "tuba": 1.0, "acc": 1.0, "clar": 0.0, "xylo": 0.0, "drums": 0.8, "tamb": 0.6},
        ], stage=3, energy=0.9, reverb=(1.6, 1.2, 0.5), wet=0.22, master_lp=11000, hi_shelf=-4.5)

CH = prog_at(["Dm", "A7", "Dm", "Gm", "Dm", "A7", "Bb", "A7"], per=2)
SC = scale_of(2, "harmonic")
RUN = [[(i, 1) for i in range(14)] + [(14, 2), (16, 1), (17, 1), (18, 1), (19, 1), (20, 2), (22, 2), (24, 1), (25, 1), (26, 1), (27, 1), (28, 4)],
       [(0, 2), (2, 1), (3, 1), (4, 2), (6, 1), (7, 1), (8, 1), (9, 1), (10, 1), (11, 1), (12, 4), (16, 1), (17, 1), (18, 2), (20, 1),
        (21, 1), (22, 1), (23, 1), (24, 2), (26, 2), (28, 4)]]
XY = [[(2, 1), (3, 1), (6, 1), (7, 1), (10, 2), (14, 1), (15, 1), (18, 1), (19, 1), (22, 2), (26, 1), (27, 1), (28, 2)]]


def build():
    tu = Layer("tuba", dry=1.0, rev=0.08, lp=1500, tau=1.0)
    ac = Layer("acc", dry=0.65, rev=0.25, hp=200, lp=5000, tau=1.0, gain=0.6)
    cl = Layer("clar", dry=0.6, rev=0.3, hp=250, lp=5500, tau=1.5)
    xy = Layer("xylo", dry=0.6, rev=0.3, hp=400, lp=8000, tau=1.5)
    dr = Layer("drums", dry=0.85, rev=0.2, lp=9000, tau=1.0)
    tb_ = Layer("tamb", dry=0.6, rev=0.15, hp=4500, tau=1.0, gain=2.0)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        b = bass_note(ch, 33)
        tu.note(tb(bar, 0), "tuba", b, E.BEAT * 0.7, 0.7)
        tu.note(tb(bar, 2), "tuba", b + 7 if b + 7 <= 47 else b - 5, E.BEAT * 0.7, 0.62)
        vo = voicing(ch, 60, 72, prev, maxn=4)
        prev = vo
        for bt in (1, 3):
            for m in vo:
                ac.note(tb(bar, bt), "accordion", m, E.BEAT * 0.45, 0.3, pan=-0.25)
        if bar % 4 == 3:
            for m in vo:
                ac.note(tb(bar, 3.5), "accordion", m, E.BEAT * 0.4, 0.26, pan=-0.25)
        if lv("drums", bar) > 0:
            pattern(dr, bar, "X-------X-------", lambda i: kick(60.0, 50.0, 0.03, 0.15, 0.2, 1.4), 0.55, kick=True)
            pattern(dr, bar, "----X-------X---" if bar % 4 != 3 else "----X-------xxxX", lambda i: snare(i % 4, 240, 0.08, 0.35, 3800, 0.6), 0.42, 0.1)
        pattern(tb_, bar, "x-o-x-o-x-o-x-o-", lambda i: shaker(i % 4), 0.22, 0.3)
    for b0, nb, seeds in ((16, 48, [801, 802, 803, 804]), (112, 16, [805, 806]), (128, 72, [801, 802, 807, 803, 804, 808])):
        for p in range(nb // 4):
            for bar, beat, m, d in phrase(seeds[p % len(seeds)], RUN[p % 2], 74, 69, 86, CH, SC, leaps=(-3, -2, -1, 1, 2, 3), bar0=b0 + 4 * p):
                cl.note(tb(bar, beat), "clarinet", m, d * E.BEAT * 0.85, 0.42, pan=0.15)
    for b0, nb in ((64, 48), (112, 16), (128, 72)):
        for p in range(nb // 4):
            for bar, beat, m, d in phrase(811 + p % 5, XY[0], 81, 77, 93, CH, SC, bar0=b0 + 4 * p):
                xy.note(tb(bar, beat), "xylo", m, d * E.BEAT, 0.45, pan=-0.35)
    return [tu, ac, cl, xy, dr, tb_]


if __name__ == "__main__":
    sys.exit(E.run(build))
