#!/usr/bin/env python3
"""'오로라 장막' — Planet(Cosmic Ambient) 한가(0단계) 배경음악.

비트 없는 코스믹 앰비언트: 포먼트 합창 '우' 화음이 천천히 겹치고, 높은 음역의 유리 같은 FM 벨이 반짝이며,
바람 질감과 Ab 서브 드론이 바닥을 깐다. 52 BPM 4/4 65마디 = 정확히 300초, Ab major(Abmaj9–Dbmaj7#11–Fm9–Eb7sus).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～10) → 패드 전개(10～30) → 하모닉스 고조(30～45) → 잦아듦(45～55) → 아웃트로(55～65) 처음 상태

  python music/compose_aurora.py --out <폴더>/bgm-aurora.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, prog_at, pads, voicing, bell, sub_note, texture, inst

E.setup("aurora", "오로라 장막",
        "한가 · 비트 없는 코스믹 앰비언트 — 포먼트 합창 화음, 높은 유리 벨의 반짝임, 바람 질감, 서브 드론",
        "Ab major", 52, [
            {"n": "인트로", "part": "기", "bars": 10, "choir": 0.7, "pad": 1.0, "shim": 0.3, "wind": 1.0, "sub": 0.6, "filt": 0.2},
            {"n": "패드 전개", "part": "승", "bars": 20, "choir": 1.0, "pad": 1.0, "shim": 0.6, "wind": 0.7, "sub": 1.0, "filt": 0.45},
            {"n": "하모닉스 고조", "part": "전", "bars": 15, "choir": 1.0, "pad": 0.8, "shim": 1.0, "wind": 0.6, "sub": 1.0, "filt": 0.8},
            {"n": "잦아듦", "part": "전", "bars": 10, "choir": 0.8, "pad": 1.0, "shim": 0.6, "wind": 0.9, "sub": 0.8, "filt": 0.4},
            {"n": "아웃트로", "part": "결", "bars": 10, "choir": 0.7, "pad": 1.0, "shim": 0.3, "wind": 1.0, "sub": 0.6, "filt": 0.2},
        ], stage=0, energy=0.08, reverb=(7.0, 6.0, 2.8), wet=0.7, echo_beats=1.5, echo_fb=0.55, master_lp=10000)

CH = prog_at(["Abmaj9", "Dbmaj7#11", "Fm9", "Eb7sus"], per=4)


def build():
    choir = Layer("choir", dry=0.5, rev=0.7, hp=180, lp=4500, width=1.5, tau=5.0)
    pad = Layer("pad", dry=0.45, rev=0.6, hp=90, sweep=(400, 2200), width=1.3, tau=6.0)
    shim = Layer("shim", dry=0.3, rev=0.8, echo=0.55, hp=1200, lp=9000, tau=5.0)
    wind = Layer("wind", dry=1.0, rev=0.2, hp=150, lp=2500, tau=6.0, gain=0.12)
    sub = Layer("sub", dry=1.0, lp=150, tau=5.0)
    wind.add(0.0, texture("wind", 2), 1.0)
    pads(pad, CH, 51, 63, every=4, v=0.15, a=4.0, rel=5.0, voices=6, cents=7)
    prev = None
    for bar in range(0, E.BARS, 4):
        span = min(4, E.BARS - bar)
        vo = voicing(CH(bar), 63, 79, prev, maxn=4)
        prev = vo
        for i, m in enumerate(vo):
            choir.add(tb(bar, 0.5 * i), inst("choir", m, span * E.BAR + 0.5, 0.5), 1.0, pan=-0.5 + i / 3)
        sub.add(tb(bar), sub_note(32 if (bar // 4) % 4 != 2 else 29, span * E.BAR - 0.3, 2.5, 2.0, 0.0, 1.0), 0.3)
    r = E.np.random.default_rng(52)
    for bar in range(E.BARS):
        tops = voicing(CH(bar), 84, 98, None, maxn=4)
        for k in range(2 + int(r.integers(0, 3))):
            bt = float(r.integers(0, 8)) / 2
            m = tops[int(r.integers(0, len(tops)))]
            shim.add(tb(bar, bt), bell(m, 3.5, 0.45, 3.0, 0.004), 0.22 + 0.12 * r.random(), pan=float(r.uniform(-0.8, 0.8)))
    return [choir, pad, shim, wind, sub]


if __name__ == "__main__":
    sys.exit(E.run(build))
