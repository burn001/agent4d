#!/usr/bin/env python3
"""'위성 교신' — Planet(Cosmic Ambient) 보통(1단계) 배경음악.

하프타임 스페이스 다운템포: 1박 킥·3박 스네어의 느긋한 하프타임 비트, 16분 격자 위에서 응답하듯 튀는 텔레메트리 블립,
트레몰로 걸린 일렉트릭 피아노 화음, 넓은 패드, 서브 베이스. 100 BPM 4/4 125마디 = 정확히 300초,
G mixolydian(Gadd9–Fmaj7–C–Dm7). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) → 전개(12～44) → 고조(44～76) → 브레이크(76～88) → 흐름(88～113) → 아웃트로(113～125)

  python music/compose_satellite.py --out <폴더>/bgm-satellite.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, pattern, voicing, scale_of, kick, snare, hat, sub_note, bass_note, inst

E.setup("satellite", "위성 교신",
        "보통 · 하프타임 스페이스 다운템포 — 느긋한 킥·스네어, 텔레메트리 블립, 트레몰로 일렉트릭 피아노, 넓은 패드",
        "G mixolydian", 100, [
            {"n": "인트로", "part": "기", "bars": 12, "drums": 0.0, "blip": 0.6, "ep": 0.8, "pad": 1.0, "sub": 0.5, "hat": 0.0, "filt": 0.25},
            {"n": "전개", "part": "승", "bars": 32, "drums": 1.0, "blip": 0.8, "ep": 1.0, "pad": 0.8, "sub": 1.0, "hat": 0.6, "filt": 0.45},
            {"n": "고조", "part": "전", "bars": 32, "drums": 1.0, "blip": 1.0, "ep": 1.0, "pad": 0.9, "sub": 1.0, "hat": 1.0, "filt": 0.8},
            {"n": "브레이크", "part": "전", "bars": 12, "drums": 0.0, "blip": 1.0, "ep": 0.7, "pad": 1.0, "sub": 0.5, "hat": 0.3, "filt": 0.4},
            {"n": "흐름", "part": "전", "bars": 25, "drums": 1.0, "blip": 0.9, "ep": 1.0, "pad": 0.8, "sub": 1.0, "hat": 0.9, "filt": 0.6},
            {"n": "아웃트로", "part": "결", "bars": 12, "drums": 0.0, "blip": 0.6, "ep": 0.8, "pad": 1.0, "sub": 0.5, "hat": 0.0, "filt": 0.25},
        ], stage=1, energy=0.45, reverb=(4.0, 3.2, 1.2), wet=0.45, echo_beats=0.75, echo_fb=0.5, master_lp=11000)

CH = prog_at(["Gadd9", "Fmaj7", "C", "Dm7"], per=4)
SC = scale_of(7, "mixo")


def build():
    dr = Layer("drums", dry=0.9, rev=0.25, lp=8000, tau=1.0)
    hh = Layer("hat", dry=0.6, rev=0.2, hp=6000, tau=1.5, gain=3.0)
    blip = Layer("blip", dry=0.4, rev=0.45, echo=0.6, hp=900, lp=8000, tau=2.0)
    ep = Layer("ep", dry=0.6, rev=0.4, lp=5000, hp=150, tau=2.0, trem=(1.0, 0.35), duck=0.15)
    pad = Layer("pad", dry=0.45, rev=0.6, hp=150, sweep=(500, 3000), width=1.5, tau=5.0)
    sub = Layer("sub", dry=1.0, lp=200, tau=2.0, duck=0.35)
    pads(pad, CH, 59, 74, every=4, v=0.13, a=2.5, rel=3.0, cents=13)
    r = E.np.random.default_rng(100)
    blips = [[i for i in range(16) if r.random() < 0.28] for _ in range(4)]
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 57, 72, prev, rootless=True)
        prev = vo
        for bt in ((0, 1.5) if bar % 2 == 0 else (0.5, 2.5)):
            for j, m in enumerate(vo):
                ep.note(tb(bar, bt) + 0.008 * j, "epiano", m, E.BEAT * 1.4, 0.4)
        if lv("drums", bar) > 0:
            pattern(dr, bar, "X-------x-x-----" if bar % 2 else "X---------x-----", lambda i: kick(50.0, 70.0, 0.03, 0.25, 0.2, 1.4), 0.75, kick=True)
            pattern(dr, bar, "--------X------." if bar % 4 == 3 else "--------X-------", lambda i: snare(bar % 3, 200, 0.16, 0.5, 2200, 0.5), 0.5)
        pattern(hh, bar, "x-o-x-o-x-o-x-oo", lambda i: hat(i % 4), 0.14, -0.3, swing=0.1)
        hi = [m for m in range(79, 96) if m % 12 in SC]
        for i in blips[bar % 4]:
            m = hi[int(r.integers(0, len(hi)))]
            blip.add(tb(bar, i / 4), inst("blip", m, 0.04, 0.5), 0.8, pan=float(r.uniform(-0.7, 0.7)))
        b = bass_note(ch, 31)
        sub.add(tb(bar), sub_note(b, E.BEAT * 2.2, 0.01, 0.2, 0.12), 0.38)
        sub.add(tb(bar, 2.75), sub_note(b + (7 if bar % 2 else 12), E.BEAT * 1.0, 0.01, 0.15, 0.12), 0.26)
    return [dr, hh, blip, ep, pad, sub]


if __name__ == "__main__":
    sys.exit(E.run(build))
