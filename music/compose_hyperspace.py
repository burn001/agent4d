#!/usr/bin/env python3
"""'초공간 질주' — Planet(Cosmic Ambient) 매우 활발(3단계) 배경음악.

사이키델릭 트랜스: 박마다 킥 뒤 16분 세 개로 구르는 롤링 베이스, 음높이가 떨어지는 우주 잽, 16분 햇·오픈 햇·클랩,
16분 톱니 시퀀스 리드, 높은 합창 대기. 144 BPM 4/4 180마디 = 정확히 300초, B minor(B 페달, 클라이맥스 B–G–A–F#).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 빌드업(16～48) → 드롭(48～96) → 브레이크(96～112) → 클라이맥스(112～164) → 아웃트로(164～180)

  python music/compose_hyperspace.py --out <폴더>/bgm-hyperspace.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, pattern, saw_note, kick, clap, hat, tone_hit, riser, inst

E.setup("hyperspace", "초공간 질주",
        "매우 활발 · 사이키델릭 트랜스 — 킥 뒤로 구르는 16분 베이스, 떨어지는 우주 잽, 16분 햇·클랩, 톱니 시퀀스, 높은 합창",
        "B minor", 144, [
            {"n": "인트로", "part": "기", "bars": 16, "bass": 0.0, "kick": 1.0, "hat": 0.6, "clap": 0.0, "zap": 0.5, "seq": 0.5, "air": 1.0, "fx": 0.0, "filt": 0.2},
            {"n": "빌드업", "part": "승", "bars": 32, "bass": 1.0, "kick": 1.0, "hat": 0.9, "clap": 0.8, "zap": 0.8, "seq": 0.8, "air": 0.7, "fx": 1.0, "filt": 0.5},
            {"n": "드롭", "part": "전", "bars": 48, "bass": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "zap": 1.0, "seq": 1.0, "air": 0.6, "fx": 1.0, "filt": 0.8},
            {"n": "브레이크", "part": "전", "bars": 16, "bass": 0.0, "kick": 0.0, "hat": 0.3, "clap": 0.0, "zap": 0.6, "seq": 0.8, "air": 1.0, "fx": 1.0, "filt": 0.35},
            {"n": "클라이맥스", "part": "전", "bars": 52, "bass": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "zap": 1.0, "seq": 1.0, "air": 0.8, "fx": 1.0, "filt": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 16, "bass": 0.0, "kick": 1.0, "hat": 0.6, "clap": 0.0, "zap": 0.5, "seq": 0.5, "air": 1.0, "fx": 0.0, "filt": 0.2},
        ], stage=3, energy=0.93, reverb=(2.6, 2.0, 0.7), wet=0.3, echo_beats=0.75, echo_fb=0.55, master_lp=12500, hi_shelf=-4.5)

CLIMAX = [0, 0, -4, -2, 0, 0, -4, -5]   # B B G A B B G F#
SEQ = [0, 12, 7, 10, 0, 12, 3, 7, 0, 15, 12, 7, 10, 7, 3, 2]


def root(bar):
    return CLIMAX[((bar - 112) // 2) % 8] if 112 <= bar < 164 else 0


def build():
    bass = Layer("bass", dry=1.0, rev=0.02, hp=35, lp=1400, tau=1.0)
    kk = Layer("kick", dry=1.0, rev=0.04, lp=6000, tau=0.5, gain=0.5)
    hh = Layer("hat", dry=0.65, rev=0.12, hp=7000, tau=1.0)
    cl = Layer("clap", dry=0.6, rev=0.4, hp=700, tau=1.0, gain=2.5)
    zap = Layer("zap", dry=0.45, rev=0.4, echo=0.55, hp=300, lp=7000, tau=2.0, gain=1.5)
    seq = Layer("seq", dry=0.5, rev=0.3, echo=0.35, hp=400, sweep=(1200, 6500), tau=2.0, duck=0.35)
    air = Layer("air", dry=0.4, rev=0.7, hp=600, lp=6000, width=1.6, tau=5.0, duck=0.3)
    fx = Layer("fx", dry=0.6, rev=0.5, hp=400, tau=1.0)
    for bar in range(0, E.BARS, 4):
        span = min(4, E.BARS - bar)
        for i, m in enumerate((78, 83, 86)):
            air.add(tb(bar), inst("choir", m + root(bar), span * E.BAR + 0.3, 0.45), 1.0, pan=-0.6 + 0.6 * i)
    for bar in range(E.BARS):
        r = root(bar)
        if lv("kick", bar) > 0:
            pattern(kk, bar, "X---X---X---X---", lambda i: kick(50.0, 130.0, 0.025, 0.18, 0.6, 2.2), 0.95, kick=True)
        for bt in range(4):
            for k in (1, 2, 3):
                bass.add(tb(bar, bt + k / 4), saw_note(35 + r, E.BEAT * 0.18, 1600 if k == 1 else 1100, 200, 0.03, 0.002, 0.02, q=1.5),
                         0.48 if k == 1 else 0.38)
        pattern(hh, bar, "x.x.x.x.x.x.x.x.", lambda i: hat(i % 4), 0.15, 0.25)
        pattern(hh, bar, "--x---x---x---x-", lambda i: hat(i % 3, True), 0.14, -0.2)
        pattern(cl, bar, "----X-------X---", lambda i: clap(bar % 4), 0.4)
        if bar % 2 == 1:
            bt = (3.5, 2.75, 1.25, 3.25)[(bar // 2) % 4]
            zap.hit(tb(bar, bt), tone_hit(330.0 + 110 * ((bar // 2) % 3), 0.12, 9.0, 0.035, ((1, 1.0), (2, 0.3)), 0.0), 0.35,
                    pan=0.6 if bar % 4 == 1 else -0.6)
        for i in range(16):
            m = 59 + r + SEQ[(i + (bar % 4) * 3) % 16]
            seq.add(tb(bar, i / 4), saw_note(m, 0.07, 4500, 800, 0.04, 0.002, 0.03, q=2.5), 0.24 if i % 4 else 0.32,
                    pan=-0.3 if i % 2 else 0.3)
        if bar in (44, 108, 160):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 4, 600, 9000), 0.5)
    return [bass, kk, hh, cl, zap, seq, air, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
