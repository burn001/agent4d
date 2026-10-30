#!/usr/bin/env python3
"""'스프린트' — 흐름(Intense 코딩) 활발(2단계) 배경음악.

UK 투스텝 개러지: 건너뛰는 킥, 2·4박 스네어와 고스트, 셔플 16분 햇, 엇박 오르간 화음 스탭, 짧은 합창 '아' 조각, 움직이는 서브 베이스.
132 BPM 4/4 165마디 = 정확히 300초, Eb minor(Ebm9–Bmaj7–Abm9–Bb7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 그루브(16～64) → 브레이크(64～80) → 클라이맥스(80～136) → 정리(136～149) → 아웃트로(149～165)

  python music/compose_sprint.py --out <폴더>/bgm-sprint.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, pattern, voicing, kick, snare, hat, shaker, sub_note, riser, bass_note

E.setup("sprint", "스프린트",
        "활발 · UK 투스텝 개러지 — 건너뛰는 킥, 셔플 햇, 엇박 오르간 스탭, 합창 조각, 움직이는 서브 베이스",
        "Eb minor", 132, [
            {"n": "인트로", "part": "기", "bars": 16, "drums": 0.6, "hat": 0.8, "organ": 0.7, "vox": 0.0, "sub": 0.0, "pad": 0.8, "fx": 0.0},
            {"n": "그루브", "part": "승", "bars": 48, "drums": 1.0, "hat": 1.0, "organ": 1.0, "vox": 0.5, "sub": 1.0, "pad": 0.6, "fx": 1.0},
            {"n": "브레이크", "part": "전", "bars": 16, "drums": 0.0, "hat": 0.5, "organ": 0.7, "vox": 1.0, "sub": 0.4, "pad": 1.0, "fx": 1.0},
            {"n": "클라이맥스", "part": "전", "bars": 56, "drums": 1.0, "hat": 1.0, "organ": 1.0, "vox": 1.0, "sub": 1.0, "pad": 0.8, "fx": 1.0},
            {"n": "정리", "part": "결", "bars": 13, "drums": 0.8, "hat": 0.9, "organ": 0.9, "vox": 0.3, "sub": 0.6, "pad": 0.8, "fx": 0.0},
            {"n": "아웃트로", "part": "결", "bars": 16, "drums": 0.6, "hat": 0.8, "organ": 0.7, "vox": 0.0, "sub": 0.0, "pad": 0.8, "fx": 0.0},
        ], stage=2, energy=0.68, reverb=(2.0, 1.5, 0.6), wet=0.25, echo_beats=0.5, master_lp=12000)

CH = prog_at(["Ebm9", "Bmaj7", "Abm9", "Bb7sus"], per=4)
KICK = ["X-----x---X-----", "X-------x-X---x-"]
SNR = "----X--.----X-.-"
HATS = "x-xox-x-xox-x-xo"
STAB = ["--x--x----x--x--", "-x---x--x---x-x-"]
SUB = [((0, 0.75, 0), (0.75, 0.5, 0), (1.75, 0.5, 7), (2.5, 1.0, 0), (3.5, 0.4, 10)),
       ((0, 1.0, 0), (1.5, 0.5, 12), (2.0, 0.5, 10), (2.75, 1.0, 7))]


def build():
    dr = Layer("drums", dry=0.9, rev=0.12, lp=9000, tau=1.0)
    hh = Layer("hat", dry=0.7, rev=0.1, hp=6500, tau=1.0)
    org = Layer("organ", dry=0.55, rev=0.3, echo=0.25, lp=4200, hp=250, tau=2.0, duck=0.3)
    vox = Layer("vox", dry=0.5, rev=0.45, echo=0.4, lp=5000, hp=400, tau=2.0, gain=1.6)
    sub = Layer("sub", dry=1.0, lp=220, tau=1.0, duck=0.4)
    pad = Layer("pad", dry=0.45, rev=0.55, hp=220, lp=3000, width=1.3, tau=4.0, duck=0.3)
    fx = Layer("fx", dry=0.6, rev=0.5, hp=400, tau=1.0)
    pads(pad, CH, 58, 74, every=4, v=0.11, a=1.5, rel=2.0, cents=12)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 58, 73, prev, rootless=True)
        prev = vo
        pattern(dr, bar, KICK[bar % 2], lambda i: kick(52.0, 85.0, 0.03, 0.2, 0.35, 1.6), 0.8, kick=True, swing=0.33)
        pattern(dr, bar, SNR, lambda i: snare(i % 3, 230, 0.1, 0.4, 3500, 0.6), 0.55, 0.05, swing=0.33)
        pattern(hh, bar, HATS, lambda i: hat(i % 4) if i % 4 else shaker(i % 3), 0.2, 0.2, swing=0.33)
        for i, c in enumerate(STAB[(bar // 2) % 2]):
            if c == "x":
                for j, m in enumerate(vo):
                    org.note(tb(bar, i / 4 + (0.33 / 4 if i % 2 else 0)) + 0.004 * j, "organ", m, E.BEAT * 0.22, 0.32)
        if bar % 2 == 1:
            top = voicing(ch, 72, 84, None, maxn=3)
            for k, bt in enumerate((1.5, 2.25, 3.0)):
                vox.note(tb(bar, bt), "voxchop", top[k % len(top)], E.BEAT * 0.35, 0.5, pan=0.25 * (k - 1))
        b = bass_note(ch, 27)
        for bt, d, off in SUB[(bar // 4) % 2]:
            sub.add(tb(bar, bt), sub_note(b + off, E.BEAT * d, 0.006, 0.06, 0.3, 1.8), 0.4)
        if bar in (60, 76, 132):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 4, 900, 8000), 0.45)
    return [dr, hh, org, vox, sub, pad, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
