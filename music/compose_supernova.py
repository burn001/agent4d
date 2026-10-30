#!/usr/bin/env python3
"""'초신성' — Planet(Cosmic Ambient) 매우 활발(3단계) 배경음악.

코스믹 트랜스: 8분으로 잘리는 게이트 슈퍼소 패드, 킥 사이 16분 롤링 베이스, 포온더플로어 킥·뒷박 오픈 햇·클랩,
긴 톱니 리드 선율, 긴 브레이크다운과 잡음 상승. 136 BPM 4/4 170마디 = 정확히 300초, F# minor(F#m–D–A–E).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 빌드업(16～48) → 드롭(48～96) → 브레이크다운(96～120) → 클라이맥스(120～154) → 아웃트로(154～170)

  python music/compose_supernova.py --out <폴더>/bgm-supernova.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import (Layer, tb, lv, prog_at, pads, pattern, voicing, scale_of, saw_note, kick, clap, hat, riser, bass_note,
                    phrase)

E.setup("supernova", "초신성",
        "매우 활발 · 코스믹 트랜스 — 8분 게이트 슈퍼소 패드, 롤링 베이스, 킥·오픈 햇·클랩, 긴 톱니 리드, 잡음 상승",
        "F# minor", 136, [
            {"n": "인트로", "part": "기", "bars": 16, "gate": 0.6, "bass": 0.0, "kick": 1.0, "hat": 0.6, "clap": 0.0, "lead": 0.0, "pad": 0.6, "fx": 0.0, "filt": 0.25},
            {"n": "빌드업", "part": "승", "bars": 32, "gate": 0.9, "bass": 1.0, "kick": 1.0, "hat": 0.9, "clap": 1.0, "lead": 0.0, "pad": 0.5, "fx": 1.0, "filt": 0.5},
            {"n": "드롭", "part": "전", "bars": 48, "gate": 1.0, "bass": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "lead": 1.0, "pad": 0.6, "fx": 1.0, "filt": 0.8},
            {"n": "브레이크다운", "part": "전", "bars": 24, "gate": 0.3, "bass": 0.0, "kick": 0.0, "hat": 0.2, "clap": 0.0, "lead": 0.8, "pad": 1.0, "fx": 1.0, "filt": 0.4},
            {"n": "클라이맥스", "part": "전", "bars": 34, "gate": 1.0, "bass": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "lead": 1.0, "pad": 0.7, "fx": 1.0, "filt": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 16, "gate": 0.6, "bass": 0.0, "kick": 1.0, "hat": 0.6, "clap": 0.0, "lead": 0.0, "pad": 0.6, "fx": 0.0, "filt": 0.25},
        ], stage=3, energy=0.88, reverb=(3.0, 2.4, 0.8), wet=0.35, echo_beats=0.75, echo_fb=0.45, master_lp=12000, hi_shelf=-4.5)

CH = prog_at(["F#m", "D", "A", "E"], per=4)
SC = scale_of(6, "minor")
LEAD = [[(0, 6), (6, 2), (8, 4), (12, 4), (16, 6), (22, 2), (24, 8)], [(0, 4), (4, 4), (8, 6), (14, 2), (16, 4), (20, 4), (24, 8)]]


def build():
    gate = Layer("gate", dry=0.55, rev=0.35, hp=250, sweep=(1000, 6500), width=1.5, tau=2.0, trem=(0.5, 0.85), duck=0.4, gain=2.5)
    bass = Layer("bass", dry=1.0, rev=0.02, lp=1200, tau=1.0, duck=0.0)
    kk = Layer("kick", dry=1.0, rev=0.05, lp=5000, tau=0.5, gain=0.5)
    hh = Layer("hat", dry=0.65, rev=0.15, hp=6500, tau=1.0)
    cl = Layer("clap", dry=0.6, rev=0.45, hp=600, tau=1.0, gain=2.5)
    lead = Layer("lead", dry=0.5, rev=0.45, echo=0.45, hp=350, lp=6500, tau=2.0, duck=0.25)
    pad = Layer("pad", dry=0.45, rev=0.65, hp=150, lp=3500, width=1.5, tau=5.0)
    fx = Layer("fx", dry=0.6, rev=0.5, hp=400, tau=1.0)
    pads(gate, CH, 61, 78, every=4, v=0.16, a=0.05, rel=0.6, voices=7, cents=22)
    pads(pad, CH, 54, 69, every=4, v=0.12, a=3.0, rel=3.0, voices=5, cents=10)
    for bar in range(E.BARS):
        ch = CH(bar)
        b = bass_note(ch, 30)
        for i in range(16):
            if i % 4:
                bass.add(tb(bar, i / 4), saw_note(b, E.BEAT * 0.2, 1500, 300, 0.04, 0.002, 0.025), 0.5 if i % 4 == 2 else 0.4)
        if lv("kick", bar) > 0:
            pattern(kk, bar, "X---X---X---X---", lambda i: kick(48.0, 115.0, 0.028, 0.22, 0.5, 2.0), 0.9, kick=True)
        pattern(hh, bar, "--X---X---X---X-", lambda i: hat(i % 4, True), 0.2, 0.2)
        pattern(hh, bar, "x.x.x.x.x.x.x.x.", lambda i: hat(i % 4), 0.12, -0.25)
        pattern(cl, bar, "----X-------X---", lambda i: clap(bar % 4), 0.45)
        if bar in (44, 116, 150):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 4, 700, 9000), 0.5)
    for b0, nb, seeds in ((48, 48, [11, 12, 13, 14]), (96, 24, [15, 16, 17]), (120, 32, [11, 18, 13, 19])):
        for p in range(nb // 4):
            for bar, beat, m, d in phrase(seeds[p % len(seeds)], LEAD[p % 2], 78, 73, 90, CH, SC, bar0=b0 + 4 * p):
                lead.add(tb(bar, beat), saw_note(m, d * E.BEAT * 0.95, 3500, 1500, 0.3, 0.01, 0.2, q=1.2), 0.4)
    return [gate, bass, kk, hh, cl, lead, pad, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
