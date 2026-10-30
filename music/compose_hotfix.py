#!/usr/bin/env python3
"""'핫픽스' — 흐름(Intense 코딩) 매우 활발(3단계) 배경음악.

애시드 테크노: 공진 필터가 꽥꽥대는 16분 애시드 베이스(악센트·옥타브 도약), 묵직한 포온더플로어 킥, 16분 햇·뒷박 오픈 햇,
2·4박 클랩, 금속성 타악, 잡음 상승. 148 BPM 4/4 185마디 = 정확히 300초, D phrygian(D 페달, 클라이맥스에서 Gm·Bb 로 옮겨 감).
시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 빌드업(16～48) → 드롭(48～96) → 브레이크다운(96～112) → 클라이맥스(112～160) → 아웃트로(160～185)

  python music/compose_hotfix.py --out <폴더>/bgm-hotfix.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, pattern, saw_note, kick, clap, hat, tone_hit, riser, pad_note, sub_note

E.setup("hotfix", "핫픽스",
        "매우 활발 · 애시드 테크노 — 꽥꽥대는 16분 애시드 베이스, 묵직한 킥, 16분 햇·클랩, 금속성 타악, 잡음 상승",
        "D phrygian", 148, [
            {"n": "인트로", "part": "기", "bars": 16, "acid": 0.6, "kick": 1.0, "hat": 0.6, "clap": 0.0, "perc": 0.5, "drone": 0.8, "fx": 0.0, "filt": 0.15},
            {"n": "빌드업", "part": "승", "bars": 32, "acid": 0.9, "kick": 1.0, "hat": 0.9, "clap": 1.0, "perc": 0.8, "drone": 0.6, "fx": 1.0, "filt": 0.45},
            {"n": "드롭", "part": "전", "bars": 48, "acid": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "perc": 1.0, "drone": 0.6, "fx": 1.0, "filt": 0.8},
            {"n": "브레이크다운", "part": "전", "bars": 16, "acid": 0.8, "kick": 0.0, "hat": 0.4, "clap": 0.0, "perc": 0.6, "drone": 1.0, "fx": 1.0, "filt": 0.3},
            {"n": "클라이맥스", "part": "전", "bars": 48, "acid": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "perc": 1.0, "drone": 0.7, "fx": 1.0, "filt": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 25, "acid": 0.6, "kick": 1.0, "hat": 0.6, "clap": 0.0, "perc": 0.5, "drone": 0.8, "fx": 0.0, "filt": 0.15},
        ], stage=3, energy=0.9, reverb=(1.8, 1.3, 0.5), wet=0.22, echo_beats=0.75, master_lp=12500, hi_shelf=-4.0)

# 16칸 애시드 패턴: (음정 오프셋 D 기준, 악센트) / None = 쉼
ACID = [[(0, 1), (0, 0), (12, 0), None, (1, 1), (0, 0), (0, 0), (13, 0), (0, 1), None, (10, 0), (12, 1), (0, 0), (3, 0), (1, 1), (0, 0)],
        [(0, 1), (12, 0), (0, 0), (0, 0), (5, 1), None, (3, 0), (1, 0), (0, 1), (0, 0), (15, 1), (12, 0), None, (10, 0), (8, 1), (7, 0)]]
ROOTS = [0, 0, 0, 0, 5, 5, 8, 1]  # 클라이맥스 8마디 순환: D D D D G G Bb Eb


def root(bar):
    return ROOTS[(bar - 112) % 8] if 112 <= bar < 160 else (1 if bar % 16 >= 14 else 0)


def build():
    acid = Layer("acid", dry=0.85, rev=0.15, echo=0.25, hp=60, sweep=(600, 5500), tau=2.0, duck=0.45, drive=0.6)
    kk = Layer("kick", dry=1.0, rev=0.06, lp=5000, tau=0.5, gain=0.45)
    hh = Layer("hat", dry=0.7, rev=0.1, hp=7000, tau=1.0)
    cl = Layer("clap", dry=0.65, rev=0.4, hp=600, tau=1.0, gain=3.0)
    perc = Layer("perc", dry=0.6, rev=0.3, echo=0.3, hp=900, tau=1.5, gain=2.0)
    drone = Layer("drone", dry=0.4, rev=0.6, hp=120, lp=1800, width=1.5, tau=4.0, duck=0.5)
    fx = Layer("fx", dry=0.6, rev=0.5, hp=500, tau=1.0)
    for bar in range(0, E.BARS, 4):
        span = min(4, E.BARS - bar)
        for m in (50, 57, 63):
            drone.add(tb(bar), pad_note(m + root(bar), span * E.BAR + 0.2, 1.0, 1.5, 4, 18), 0.12)
    for bar in range(E.BARS):
        r = root(bar)
        pat = ACID[(bar // 2) % 2]
        for i, st in enumerate(pat):
            if st is None:
                continue
            off, acc = st
            acid.add(tb(bar, i / 4), saw_note(38 + r + off, E.BEAT * (0.22 if acc else 0.18), 3800 if acc else 2200, 300,
                                              0.07 if acc else 0.045, 0.002, 0.03, q=6.0 if acc else 4.0), 0.5 if acc else 0.36)
        if lv("kick", bar) > 0:
            pattern(kk, bar, "X---X---X---X---", lambda i: kick(46.0, 120.0, 0.028, 0.26, 0.5, 2.2), 0.9, kick=True)
        pattern(hh, bar, "x.x.x.x.x.x.x.xx", lambda i: hat(i % 4), 0.17, -0.2)
        pattern(hh, bar, "--x---x---x---x-", lambda i: hat(i % 3, True), 0.15, 0.2)
        pattern(cl, bar, "----X-------X---", lambda i: clap(bar % 4), 0.45)
        for i in ((3, 11) if bar % 2 else (6, 9, 14)):
            perc.hit(tb(bar, i / 4), tone_hit(530.0 + 70 * (i % 3), 0.05, 0.4, 0.004, ((1, 1.0), (1.48, 0.7), (2.37, 0.45), (3.1, 0.3)),
                                              0.2, 6000, i % 3), 0.3, pan=0.5 if i % 2 else -0.5)
        if bar in (44, 108, 156):
            fx.add(tb(bar), riser(4 * E.BAR, bar % 4, 600, 8000), 0.5)
        if bar in (48, 112):
            fx.add(tb(bar), hat(9, True), 0.7)
            fx.add(tb(bar), sub_note(26, 1.2, 0.002, 0.5, 0.0, 1.0), 0.5)
    return [acid, kk, hh, cl, perc, drone, fx]


if __name__ == "__main__":
    sys.exit(E.run(build))
