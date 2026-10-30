#!/usr/bin/env python3
"""'창가의 비' — 복셀(카페·사무실) 한가(0단계) 배경음악.

빗소리가 들리는 창가의 서정: 펠트 피아노 왼손 분산화음과 오른손 노래, B 구간 첼로 대선율, 창밖 빗소리 질감. 비트 없음.
56 BPM 4/4 70마디 = 정확히 300초, Eb major(Ebmaj7–Cm9–Abmaj7–Bb7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～8) → A(8～32) 피아노 노래 → B(32～52) 첼로 대선율 → A · 다시(52～62) → 아웃트로(62～70)

  python music/compose_rainwindow.py --out <폴더>/bgm-rainwindow.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, prog_at, melody, voicing, scale_of, bass_note, texture

E.setup("rainwindow", "창가의 비",
        "한가 · 빗소리 창가의 서정 — 펠트 피아노 분산화음과 노래, 첼로 대선율, 창밖 빗소리",
        "Eb major", 56, [
            {"n": "인트로", "part": "기", "bars": 8, "lh": 1.0, "rh": 0.0, "cello": 0.0, "rain": 1.0},
            {"n": "A", "part": "승", "bars": 24, "lh": 1.0, "rh": 1.0, "cello": 0.0, "rain": 0.8},
            {"n": "B", "part": "전", "bars": 20, "lh": 0.9, "rh": 0.8, "cello": 1.0, "rain": 0.8},
            {"n": "A · 다시", "part": "전", "bars": 10, "lh": 1.0, "rh": 1.0, "cello": 0.4, "rain": 0.8},
            {"n": "아웃트로", "part": "결", "bars": 8, "lh": 1.0, "rh": 0.0, "cello": 0.0, "rain": 1.0},
        ], stage=0, energy=0.1, reverb=(3.0, 2.4, 0.9), wet=0.38, master_lp=8500, hi_shelf=-5.0)

CH = prog_at(["Ebmaj7", "Cm9", "Abmaj7", "Bb7sus"], per=2)
SC = scale_of(3, "major")
RH = [[(0, 3), (3, 1), (4, 4), (8, 2), (10, 2), (12, 4), (16, 6), (22, 2), (24, 8)],
      [(0, 2), (2, 2), (4, 6), (10, 2), (12, 4), (16, 3), (19, 1), (20, 4), (24, 8)]]
CE = [[(0, 8), (8, 4), (12, 4), (16, 8), (24, 8)], [(0, 4), (4, 4), (8, 8), (16, 6), (22, 2), (24, 8)]]


def build():
    lh = Layer("lh", dry=0.7, rev=0.4, lp=4000, hp=60, tau=3.0, gain=0.6)
    rh = Layer("rh", dry=0.7, rev=0.45, lp=5000, hp=150, tau=3.0)
    ce = Layer("cello", dry=0.6, rev=0.45, lp=3000, hp=60, tau=3.0)
    rain = Layer("rain", dry=1.0, rev=0.15, hp=300, lp=7500, width=1.4, tau=5.0, gain=0.1)
    rain.add(0.0, texture("rain", 6), 1.0)
    for bar in range(E.BARS):
        ch = CH(bar)
        b = bass_note(ch, 39)
        up = voicing(ch, 55, 70, None, rootless=True, maxn=3)
        notes = [b, b + 7, up[0], up[1 % len(up)], up[-1], up[1 % len(up)], up[0], b + 7]
        for i, m in enumerate(notes):
            lh.note(tb(bar, i / 2), "felt", m, E.BEAT * (2.5 if i == 0 else 1.2), 0.42 if i == 0 else 0.3, pan=-0.15)
    melody(rh, "felt", 8, 24, [201, 202, 203], RH, CH, SC, 0.55, 0.15, lo=67, hi=84, legato=1.3)
    melody(rh, "felt", 32, 20, [204, 205, 206, 207, 208], RH, CH, SC, 0.45, 0.15, lo=70, hi=86, legato=1.3)
    melody(rh, "felt", 52, 8, [201, 202], RH, CH, SC, 0.5, 0.15, lo=67, hi=84, legato=1.3)
    melody(ce, "cello", 32, 20, [211, 212, 213, 214, 215], CE, CH, SC, 0.45, -0.2, lo=48, hi=62, legato=1.0,
           leaps=(-3, -2, -1, 1, 2, 3))
    melody(ce, "cello", 52, 8, [211, 212], CE, CH, SC, 0.35, -0.2, lo=48, hi=62, legato=1.0)
    return [lh, rh, ce, rain]


if __name__ == "__main__":
    sys.exit(E.run(build))
