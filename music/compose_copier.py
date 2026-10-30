#!/usr/bin/env python3
"""'복사기 디스코' — 복셀(카페·사무실) 활발(2단계) 배경음악.

누디스코: 옥타브로 뛰는 8분 일렉 베이스, 포온더플로어 킥·뒷박 오픈 햇·클랩, 16분으로 끊어 치는 스틸 기타 촙,
금관 화음 스탭, 클라이맥스의 디스코 현악 선율. 124 BPM 4/4 155마디 = 정확히 300초,
Db major(Dbmaj7–Bbm9–Gbmaj7–Ab7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → 그루브(16～48) → B(48～80) → 브레이크(80～96) → 클라이맥스(96～139) → 아웃트로(139～155)

  python music/compose_copier.py --out <폴더>/bgm-copier.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pattern, voicing, scale_of, bass_note, kick, clap, hat, phrase

E.setup("copier", "복사기 디스코",
        "활발 · 누디스코 — 옥타브 8분 베이스, 포온더플로어 킥·오픈 햇·클랩, 16분 기타 촙, 금관 스탭, 디스코 현악",
        "Db major", 124, [
            {"n": "인트로", "part": "기", "bars": 16, "bass": 1.0, "kick": 1.0, "hat": 0.7, "clap": 0.0, "gtr": 0.6, "stab": 0.0, "str": 0.0},
            {"n": "그루브", "part": "승", "bars": 32, "bass": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "gtr": 1.0, "stab": 1.0, "str": 0.0},
            {"n": "B", "part": "전", "bars": 32, "bass": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "gtr": 0.8, "stab": 0.6, "str": 0.8},
            {"n": "브레이크", "part": "전", "bars": 16, "bass": 0.5, "kick": 0.0, "hat": 0.5, "clap": 0.0, "gtr": 1.0, "stab": 0.0, "str": 1.0},
            {"n": "클라이맥스", "part": "전", "bars": 43, "bass": 1.0, "kick": 1.0, "hat": 1.0, "clap": 1.0, "gtr": 1.0, "stab": 1.0, "str": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 16, "bass": 1.0, "kick": 1.0, "hat": 0.7, "clap": 0.0, "gtr": 0.6, "stab": 0.0, "str": 0.0},
        ], stage=2, energy=0.72, reverb=(2.0, 1.5, 0.6), wet=0.26, master_lp=11500, hi_shelf=-4.0)

CH = prog_at(["Dbmaj7", "Bbm9", "Gbmaj7", "Ab7sus"], per=2)
SC = scale_of(1, "major")
STR = [[(0, 6), (6, 2), (8, 8), (16, 4), (20, 4), (24, 8)], [(0, 4), (4, 4), (8, 4), (12, 4), (16, 8), (24, 8)]]
GTR = "x-xxx-x-x-xxx-xx"
STAB = "------x--x------"


def build():
    bass = Layer("bass", dry=1.0, rev=0.03, lp=1600, tau=1.0, duck=0.4, gain=0.5)
    kk = Layer("kick", dry=1.0, rev=0.05, lp=4000, tau=0.5, gain=0.6)
    hh = Layer("hat", dry=0.65, rev=0.15, hp=6500, tau=1.0)
    cl = Layer("clap", dry=0.6, rev=0.4, hp=600, tau=1.0, gain=2.5)
    gt = Layer("gtr", dry=0.6, rev=0.2, hp=500, lp=5500, tau=1.5)
    sb = Layer("stab", dry=0.6, rev=0.3, hp=250, lp=5000, tau=1.5)
    st = Layer("str", dry=0.55, rev=0.5, hp=250, lp=6000, width=1.4, tau=2.0, duck=0.2)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        b = bass_note(ch, 37)
        for i in range(8):
            bass.note(tb(bar, i / 2), "ebass", b + (12 if i % 2 else 0), E.BEAT * 0.4, 0.62 if i % 2 == 0 else 0.5)
        if lv("kick", bar) > 0:
            pattern(kk, bar, "X---X---X---X---", lambda i: kick(52.0, 85.0, 0.03, 0.22, 0.35, 1.6), 0.82, kick=True)
        pattern(hh, bar, "--X---X---X---X-", lambda i: hat(i % 4, True), 0.18, 0.2)
        pattern(hh, bar, "x-x-x-x-x-x-x-x-", lambda i: hat(i % 4), 0.1, -0.2)
        pattern(cl, bar, "----X-------X---", lambda i: clap(bar % 4), 0.45)
        gv = voicing(ch, 64, 76, None, rootless=True, maxn=3)
        for i, c in enumerate(GTR):
            if c == "x":
                for j, m in enumerate(gv):
                    gt.note(tb(bar, i / 4) + 0.003 * j, "steel", m, E.BEAT * 0.1, 0.24 if i % 4 == 0 else 0.18, pan=0.35)
        vo = voicing(ch, 60, 74, prev, maxn=4)
        prev = vo
        if bar % 2 == 1:
            for i, c in enumerate(STAB):
                if c == "x":
                    for m in vo:
                        sb.note(tb(bar, i / 4), "brass", m, E.BEAT * 0.3, 0.3, pan=-0.2)
    for b0, nb, seeds in ((48, 32, [701, 702, 703, 704]), (80, 16, [705, 706]), (96, 40, [701, 707, 703, 708, 709])):
        for p in range(nb // 4):
            for bar, beat, m, d in phrase(seeds[p % len(seeds)], STR[p % 2], 79, 72, 89, CH, SC, bar0=b0 + 4 * p):
                for o in (0, -12):
                    st.note(tb(bar, beat), "strings", m + o, d * E.BEAT * 1.0, 0.36 if o == 0 else 0.24)
    return [bass, kk, hh, cl, gt, sb, st]


if __name__ == "__main__":
    sys.exit(E.run(build))
