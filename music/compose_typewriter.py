#!/usr/bin/env python3
"""'타자기 산책' — 복셀(카페·사무실) 보통(1단계) 배경음악.

가벼운 스윙 산책: 스윙 8분으로 또각거리는 타자기 타건과 줄 끝의 '땡' 벨, 피치카토 현 컴핑, 클라리넷 주제,
업라이트 베이스 2비트, 브러시 스네어. 108 BPM 4/4 135마디 = 정확히 300초,
Ab major(Abmaj7–Fm7–Bbm7–Eb7–Cm7–F7–Bbm7–Eb7). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) → A(12～44) → B(44～76) 비브라폰 → A · 다시(76～108) → 정리(108～123) → 아웃트로(123～135)

  python music/compose_typewriter.py --out <폴더>/bgm-typewriter.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, melody, voicing, scale_of, bass_note, tone_hit, noise_hit, bell, kick

E.setup("typewriter", "타자기 산책",
        "보통 · 가벼운 스윙 — 타자기 타건과 줄 끝 벨, 피치카토 컴핑, 클라리넷 주제, 업라이트 베이스 2비트, 브러시",
        "Ab major", 108, [
            {"n": "인트로", "part": "기", "bars": 12, "type": 0.8, "pizz": 1.0, "clar": 0.0, "vib": 0.0, "bass": 0.6, "brush": 0.5},
            {"n": "A", "part": "승", "bars": 32, "type": 1.0, "pizz": 1.0, "clar": 1.0, "vib": 0.0, "bass": 1.0, "brush": 1.0},
            {"n": "B", "part": "전", "bars": 32, "type": 0.7, "pizz": 0.8, "clar": 0.4, "vib": 1.0, "bass": 1.0, "brush": 1.0},
            {"n": "A · 다시", "part": "전", "bars": 32, "type": 1.0, "pizz": 1.0, "clar": 1.0, "vib": 0.3, "bass": 1.0, "brush": 1.0},
            {"n": "정리", "part": "결", "bars": 15, "type": 0.9, "pizz": 1.0, "clar": 0.5, "vib": 0.0, "bass": 0.8, "brush": 0.7},
            {"n": "아웃트로", "part": "결", "bars": 12, "type": 0.8, "pizz": 1.0, "clar": 0.0, "vib": 0.0, "bass": 0.6, "brush": 0.5},
        ], stage=1, energy=0.4, reverb=(2.0, 1.5, 0.6), wet=0.28, master_lp=10000, hi_shelf=-4.0)

CH = prog_at(["Abmaj7", "Fm7", "Bbm7", "Eb7", "Cm7", "F7", "Bbm7", "Eb7"], per=2)
SC = scale_of(8, "major")
SW = 0.62  # 스윙 8분 뒤 음 자리(박 안 비율)
CLT = [[(0, 2), (2, 1), (3, 1), (4, 2), (6, 2), (8, 4), (13, 1), (14, 2), (16, 2), (18, 2), (20, 4), (26, 2), (28, 4)],
       [(1, 1), (2, 2), (4, 1), (5, 1), (6, 2), (8, 6), (16, 1), (17, 1), (18, 2), (20, 2), (22, 2), (24, 8)]]


def sw(beat):
    """8분 격자 박 → 스윙 자리."""
    b = int(beat)
    return b + (SW if beat - b >= 0.5 else 0.0)


def build():
    ty = Layer("type", dry=0.7, rev=0.2, hp=600, lp=9000, tau=2.0, gain=2.0)
    pz = Layer("pizz", dry=0.75, rev=0.3, lp=4500, hp=120, tau=2.0)
    cl = Layer("clar", dry=0.6, rev=0.35, lp=5000, hp=200, tau=2.0)
    vib = Layer("vib", dry=0.55, rev=0.4, lp=7000, hp=300, tau=2.0)
    bass = Layer("bass", dry=1.0, rev=0.08, lp=1500, tau=1.5, gain=0.45)
    br = Layer("brush", dry=0.7, rev=0.25, hp=500, lp=7000, tau=2.0, gain=2.0)
    r = E.np.random.default_rng(108)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 60, 74, prev, rootless=True)
        prev = vo
        for bt in ((0.5, 2.5) if bar % 2 else (1.0, 2.5, 3.5)):
            for j, m in enumerate(vo):
                pz.note(tb(bar, sw(bt)) + 0.006 * j, "pizz", m, E.BEAT * 0.4, 0.34)
        b = bass_note(ch, 32)
        bass.note(tb(bar, 0), "upright", b, E.BEAT * 1.8, 0.75)
        bass.note(tb(bar, 2), "upright", b + 7 if bar % 2 == 0 else b + 4, E.BEAT * 1.8, 0.65)
        for bt in (1, 3):
            br.hit(tb(bar, bt), noise_hit(bar % 4, 0.09, 2800, 0.5, 7000, att=0.01), 0.3)
        for i in range(8):
            br.hit(tb(bar, sw(i / 2)), noise_hit(10 + i % 3, 0.04, 4500, 0.6, 8000, att=0.015), 0.1 if i % 2 else 0.15, pan=0.3)
        if bar % 2 == 0:
            br.hit(tb(bar), kick(56.0, 40.0, 0.03, 0.15, 0.0, 1.1), 0.25)
        for i in range(8):
            if r.random() < (0.75 if i % 2 == 0 else 0.5):
                ty.hit(tb(bar, sw(i / 2)), tone_hit(1900.0 + 300 * (i % 3), 0.012, 0.0, 0.01, ((1, 0.6), (2.3, 0.4)), 1.2, 4500, i % 4),
                       0.22 + 0.08 * r.random(), pan=float(r.uniform(-0.4, 0.4)))
        if bar % 4 == 3:
            ty.hit(tb(bar, 3.0), bell(96, 1.6, 0.3, 3.0, 0.001), 0.3, pan=0.5)
    melody(cl, "clarinet", 12, 32, [401, 402, 403, 404], CLT, CH, SC, 0.5, -0.15, lo=63, hi=80)
    melody(cl, "clarinet", 76, 32, [401, 402, 403, 404], CLT, CH, SC, 0.5, -0.15, lo=63, hi=80)
    melody(cl, "clarinet", 108, 12, [405, 406, 407], CLT, CH, SC, 0.4, -0.15, lo=63, hi=80)
    melody(vib, "vibes", 44, 32, [411, 412, 413, 414], CLT, CH, SC, 0.45, 0.2, lo=68, hi=84)
    for L in (cl, vib):  # 스윙: 8분 뒤 음을 뒤로
        L.ev = [(t + (SW - 0.5) * E.BEAT if abs(((t / E.BEAT) % 1) - 0.5) < 0.02 else t, s, v, p) for (t, s, v, p) in L.ev]
    return [ty, pz, cl, vib, bass, br]


if __name__ == "__main__":
    sys.exit(E.run(build))
