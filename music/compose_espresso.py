#!/usr/bin/env python3
"""'에스프레소 한 잔' — 복셀(카페·사무실) 보통(1단계) 배경음악.

네오소울: 뒤로 눕는 16분 스윙 드럼(림 스네어·고스트), 로즈 일렉트릭 피아노 9화음, 미끄러지는 핑거 베이스, 부드러운 색소폰 선율.
88 BPM 4/4 110마디 = 정확히 300초, G minor(Gm9–Cm9–Ebmaj7–D7b9). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～8) → A(8～40) 색소폰 → B(40～72) 로즈 솔로 → A · 다시(72～102) → 아웃트로(102～110)

  python music/compose_espresso.py --out <폴더>/bgm-espresso.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, melody, pattern, voicing, scale_of, bass_note, kick, snare, hat, tone_hit

E.setup("espresso", "에스프레소 한 잔",
        "보통 · 네오소울 — 뒤로 눕는 16분 스윙 드럼, 로즈 9화음, 미끄러지는 핑거 베이스, 부드러운 색소폰 선율",
        "G minor", 88, [
            {"n": "인트로", "part": "기", "bars": 8, "drums": 0.0, "rhodes": 1.0, "bass": 0.0, "sax": 0.0, "solo": 0.0, "hat": 0.6},
            {"n": "A", "part": "승", "bars": 32, "drums": 1.0, "rhodes": 1.0, "bass": 1.0, "sax": 1.0, "solo": 0.0, "hat": 1.0},
            {"n": "B", "part": "전", "bars": 32, "drums": 1.0, "rhodes": 0.8, "bass": 1.0, "sax": 0.2, "solo": 1.0, "hat": 1.0},
            {"n": "A · 다시", "part": "전", "bars": 30, "drums": 1.0, "rhodes": 1.0, "bass": 1.0, "sax": 1.0, "solo": 0.3, "hat": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 8, "drums": 0.0, "rhodes": 1.0, "bass": 0.0, "sax": 0.0, "solo": 0.0, "hat": 0.6},
        ], stage=1, energy=0.45, reverb=(2.2, 1.7, 0.6), wet=0.28, master_lp=9500, hi_shelf=-5.0)

CH = prog_at(["Gm9", "Cm9", "Ebmaj7", "D7b9"], per=2)
SC = scale_of(7, "dorian")
SX = [[(0, 3), (3, 1), (4, 4), (10, 2), (12, 2), (14, 2), (16, 6), (24, 3), (27, 5)],
      [(2, 2), (4, 2), (6, 2), (8, 6), (16, 2), (18, 2), (20, 4), (26, 6)]]
SOLO = [[(0, 1), (1, 1), (2, 2), (4, 1), (5, 1), (6, 2), (8, 4), (12, 1), (13, 1), (14, 2), (16, 3), (19, 1), (20, 4), (24, 2), (26, 6)]]
KICK = "X-----x---x--x--"
SNR = "----X--.-.--X-.-"
SW = 0.22


def build():
    dr = Layer("drums", dry=0.9, rev=0.15, lp=8000, tau=1.0, drive=0.3)
    hh = Layer("hat", dry=0.6, rev=0.12, hp=6000, tau=1.5, gain=2.0)
    rh = Layer("rhodes", dry=0.7, rev=0.3, lp=4500, hp=120, tau=2.0, trem=(2.0, 0.15))
    bass = Layer("bass", dry=1.0, rev=0.04, lp=1200, tau=1.5, duck=0.2, gain=0.45)
    sx = Layer("sax", dry=0.6, rev=0.4, lp=5000, hp=200, tau=2.5)
    so = Layer("solo", dry=0.6, rev=0.35, lp=5500, hp=200, tau=2.0)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 55, 72, prev, rootless=True, maxn=4)
        prev = vo
        for bt, v, d in (((0, 0.4, 2.2), (2.75, 0.3, 1.0)) if bar % 2 == 0 else ((0.75, 0.32, 1.4), (2.5, 0.34, 1.4))):
            for j, m in enumerate(vo):
                rh.note(tb(bar, bt) + 0.015 * j + 0.02, "epiano", m, E.BEAT * d, v)
        if lv("drums", bar) > 0:
            pattern(dr, bar, KICK, lambda i: kick(54.0, 60.0, 0.03, 0.2, 0.3, 1.5), 0.7, kick=True, swing=SW)
            pattern(dr, bar, SNR, lambda i: tone_hit(420.0, 0.045, 0.2, 0.01, ((1, 1.0), (1.7, 0.5)), 1.4, 2800, i % 3), 0.45, 0.05, swing=SW, jit=0.008)
        pattern(hh, bar, "x.o.x.o.x.o.x.oo", lambda i: hat(i % 4), 0.16, -0.25, swing=SW)
        b = bass_note(ch, 31)
        for bt, d, off in ((0.05, 1.2, 0), (1.5, 0.4, 12), (2.0, 0.9, 7), (3.25, 0.5, 10 if bar % 2 else 5)):
            bass.note(tb(bar, bt), "ebass", b + off, E.BEAT * d, 0.7)
    melody(sx, "sax", 8, 32, [501, 502, 503, 504], SX, CH, SC, 0.42, 0.15, lo=62, hi=79, legato=1.0)
    melody(sx, "sax", 72, 28, [501, 502, 503, 504, 505, 506, 507], SX, CH, SC, 0.42, 0.15, lo=62, hi=79, legato=1.0)
    melody(so, "epiano", 40, 32, [511, 512, 513, 514], SOLO, CH, SC, 0.48, -0.2, lo=67, hi=84)
    return [dr, hh, rh, bass, sx, so]


if __name__ == "__main__":
    sys.exit(E.run(build))
