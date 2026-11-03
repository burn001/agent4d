#!/usr/bin/env python3
"""'서류철 왈츠'(Filing Waltz) — 복셀(카페·사무실) 보통(1단계) 배경음악.

재즈 왈츠: 브러시 라이드(스윙 3박), 2·3박에 피아노 컴핑, 1박 업라이트 베이스(B 구간은 4분 워킹), 약음 금관 주제,
B 구간 피아노 선율. 132 BPM 3/4 220마디 = 정확히 300초, Eb major(Ebmaj7–Cm7–Fm7–Bb7–Gm7–C7–Fm7–Bb7).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → A(16～80) 약음 금관 → B(80～144) 피아노 · 워킹 베이스 → A · 다시(144～192) → 아웃트로(192～220)

  python music/compose_filingwaltz.py --out <폴더>/bgm-filingwaltz.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, melody, voicing, scale_of, hat, snare, bass_note, chord_pcs

E.setup("filingwaltz", "서류철 왈츠",
        "보통 · 재즈 왈츠 — 브러시 라이드, 2·3박 피아노 컴핑, 업라이트 베이스(B 구간 워킹), 약음 금관 주제, 피아노 선율",
        "Eb major", 132, [
            {"n": "인트로", "part": "기", "bars": 16, "comp": 1.0, "bass": 0.6, "brush": 0.6, "horn": 0.0, "solo": 0.0},
            {"n": "A", "part": "승", "bars": 64, "comp": 1.0, "bass": 1.0, "brush": 1.0, "horn": 1.0, "solo": 0.0},
            {"n": "B", "part": "전", "bars": 64, "comp": 0.7, "bass": 1.0, "brush": 1.0, "horn": 0.0, "solo": 1.0},
            {"n": "A · 다시", "part": "전", "bars": 48, "comp": 1.0, "bass": 1.0, "brush": 1.0, "horn": 1.0, "solo": 0.0},
            {"n": "아웃트로", "part": "결", "bars": 28, "comp": 1.0, "bass": 0.6, "brush": 0.6, "horn": 0.0, "solo": 0.0},
        ], stage=1, energy=0.46, beats=3, reverb=(2.2, 1.6, 0.6), wet=0.26, master_lp=10000, hi_shelf=-4.0)

CH = prog_at(["Ebmaj7", "Cm7", "Fm7", "Bb7", "Gm7", "C7", "Fm7", "Bb7"], per=2)
SC = scale_of(3, "major")
HN = [[(0, 4), (4, 2), (6, 6), (12, 2), (14, 2), (16, 8), (24, 6), (30, 2), (32, 4), (36, 12)],
      [(0, 2), (2, 2), (4, 2), (6, 6), (12, 6), (18, 4), (22, 2), (24, 12), (36, 12)]]
SO = [[(0, 1), (1, 1), (2, 2), (4, 2), (6, 1), (7, 1), (8, 4), (12, 2), (14, 2), (16, 2), (18, 6), (24, 2), (26, 2), (28, 2), (30, 6), (36, 12)],
      [(1, 1), (2, 1), (3, 1), (4, 4), (8, 2), (10, 2), (12, 6), (18, 2), (20, 2), (22, 2), (24, 4), (28, 2), (30, 6), (36, 12)]]
SW = 0.64


def build():
    cp = Layer("comp", dry=0.7, rev=0.3, lp=5500, hp=120, tau=2.0, gain=0.8)
    bs = Layer("bass", dry=0.85, rev=0.2, lp=2500, hp=35, tau=2.0)
    br = Layer("brush", dry=0.6, rev=0.25, hp=2500, tau=1.5, gain=1.6)
    hn = Layer("horn", dry=0.55, rev=0.4, lp=4500, hp=200, tau=3.0)
    so = Layer("solo", dry=0.65, rev=0.35, lp=6000, hp=150, tau=3.0)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 55, 70, prev, rootless=True, maxn=4)
        prev = vo
        hits = ((1, 0.8, 0.26), (2, 0.6, 0.22)) if bar % 4 != 3 else ((1, 0.5, 0.24), (1 + SW, 1.2, 0.26))
        for bt, d, v in hits:
            for j, m in enumerate(vo):
                cp.note(tb(bar, bt) + 0.006 * j, "piano", m, E.BEAT * d, v, pan=-0.15)
        r = bass_note(ch, 31)
        if lv("solo", bar) > 0:  # B 구간: 4분 워킹(근음 → 화음 음 → 다음 화음 반음 접근)
            pcs = chord_pcs(ch)
            mid = min((m for m in range(r + 2, r + 10) if m % 12 in pcs), default=r + 7)
            nxt = bass_note(CH(bar + 1), 31)
            bs.note(tb(bar), "upright", r, E.BEAT * 0.95, 0.52)
            bs.note(tb(bar, 1), "upright", mid, E.BEAT * 0.95, 0.42)
            bs.note(tb(bar, 2), "upright", nxt + (1 if nxt < r + 6 else -1), E.BEAT * 0.95, 0.4)
        else:
            bs.note(tb(bar), "upright", r, E.BEAT * 2.6, 0.52)
            if bar % 2:
                bs.note(tb(bar, 2), "upright", r + 7, E.BEAT * 0.9, 0.34)
        if lv("brush", bar) > 0:
            for bt, v in ((0, 0.16), (1, 0.13), (1 + SW, 0.09), (2, 0.13), (2 + SW, 0.09)):
                br.hit(tb(bar, bt), hat(int(bt * 2) % 4), v, pan=0.3)
            br.hit(tb(bar, 1), snare(bar % 3, 200, 0.18, 0.15, 4000, 0.4), 0.1, -0.1)
    melody(hn, "brassd", 16, 64, [901, 902, 903, 904], HN, CH, SC, 0.4, 0.15, lo=63, hi=79, per=8, legato=0.9)
    melody(so, "piano", 80, 64, [911, 912, 913, 914, 915], SO, CH, SC, 0.42, 0.1, lo=67, hi=86, per=8, legato=0.9)
    melody(hn, "brassd", 144, 48, [901, 902, 903], HN, CH, SC, 0.4, 0.15, lo=63, hi=79, per=8, legato=0.9)
    return [cp, bs, br, hn, so]


if __name__ == "__main__":
    sys.exit(E.run(build))
