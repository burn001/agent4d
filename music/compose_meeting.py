#!/usr/bin/env python3
"""'회의실 스카' — 복셀(카페·사무실) 활발(2단계) 배경음악.

신나는 스카: 뒷박을 끊어 치는 스캥크 기타, 16분 오르간 버블, 4분 걷는 일렉 베이스, 1·3박 킥과 2·4박 림 스네어·8분 햇,
금관 섹션 주제(3도 화음). 152 BPM 4/4 190마디 = 정확히 300초, E major(E–C#m–A–B7). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → A(16～64) 금관 주제 → B(64～96) 클라리넷·오르간 → 브레이크(96～112) → A · 다시(112～174) → 아웃트로(174～190)

  python music/compose_meeting.py --out <폴더>/bgm-meeting.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import (Layer, tb, lv, prog_at, pattern, voicing, scale_of, bass_note, chord_pcs, step_in, kick, hat, tone_hit,
                    phrase)

E.setup("meeting", "회의실 스카",
        "활발 · 스카 — 뒷박 스캥크 기타, 오르간 버블, 걷는 베이스, 림 스네어, 금관 섹션 주제",
        "E major", 152, [
            {"n": "인트로", "part": "기", "bars": 16, "skank": 1.0, "organ": 0.6, "bass": 1.0, "drums": 0.7, "brass": 0.0, "clar": 0.0},
            {"n": "A", "part": "승", "bars": 48, "skank": 1.0, "organ": 1.0, "bass": 1.0, "drums": 1.0, "brass": 1.0, "clar": 0.0},
            {"n": "B", "part": "전", "bars": 32, "skank": 1.0, "organ": 1.0, "bass": 1.0, "drums": 1.0, "brass": 0.3, "clar": 1.0},
            {"n": "브레이크", "part": "전", "bars": 16, "skank": 0.8, "organ": 0.5, "bass": 1.0, "drums": 0.3, "brass": 0.6, "clar": 0.4},
            {"n": "A · 다시", "part": "전", "bars": 62, "skank": 1.0, "organ": 1.0, "bass": 1.0, "drums": 1.0, "brass": 1.0, "clar": 0.4},
            {"n": "아웃트로", "part": "결", "bars": 16, "skank": 1.0, "organ": 0.6, "bass": 1.0, "drums": 0.7, "brass": 0.0, "clar": 0.0},
        ], stage=2, energy=0.68, reverb=(1.8, 1.3, 0.5), wet=0.24, master_lp=11000, hi_shelf=-4.0)

CH = prog_at(["E", "C#m", "A", "B7"], per=2)
SC = scale_of(4, "major")
BR = [[(0, 2), (2, 2), (4, 3), (7, 1), (8, 4), (12, 2), (14, 2), (16, 3), (19, 1), (20, 2), (22, 2), (24, 8)],
      [(0, 1), (1, 1), (2, 2), (4, 2), (6, 2), (8, 6), (14, 2), (16, 2), (18, 2), (20, 4), (24, 6)]]


def brass_line(L, b0, nb, seeds, v):
    for p in range(nb // 4):
        for bar, beat, m, d in phrase(seeds[p % len(seeds)], BR[p % 2], 76, 71, 83, CH, SC, bar0=b0 + 4 * p):
            dur = d * E.BEAT * 0.85
            L.note(tb(bar, beat), "brass", m, dur, v, pan=0.15)
            h = step_in(m, -2, SC)
            L.note(tb(bar, beat) + 0.006, "brassd", h, dur, v * 0.7, pan=-0.15)


def build():
    sk = Layer("skank", dry=0.7, rev=0.25, hp=400, lp=6000, tau=1.5)
    org = Layer("organ", dry=0.6, rev=0.2, hp=200, lp=4000, tau=1.5)
    bass = Layer("bass", dry=1.0, rev=0.05, lp=1500, tau=1.0, duck=0.2, gain=0.5)
    dr = Layer("drums", dry=0.85, rev=0.2, lp=9000, tau=1.0)
    br = Layer("brass", dry=0.6, rev=0.35, lp=5000, hp=250, tau=1.5)
    cl = Layer("clar", dry=0.6, rev=0.35, lp=5000, hp=250, tau=2.0)
    prev = None
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 64, 76, prev, maxn=4)
        prev = vo
        for bt in range(4):
            for j, m in enumerate(vo):
                sk.note(tb(bar, bt + 0.5) + 0.004 * j, "skank", m, E.BEAT * 0.18, 0.3, pan=0.3)
        ov = voicing(ch, 55, 67, None, maxn=3)
        for bt in range(4):
            for k in (0.75,) if bt % 2 == 0 else (0.25, 0.75):
                for m in ov:
                    org.note(tb(bar, bt + k), "organ", m, E.BEAT * 0.15, 0.2, pan=-0.3)
        pcs = chord_pcs(ch)
        b = bass_note(ch, 40)
        walk = [b, b + (4 if 4 in [(p - ch[0]) % 12 for p in pcs] else 3), b + 7, b + 9 if bar % 2 == 0 else b + 10]
        for bt, m in enumerate(walk):
            bass.note(tb(bar, bt), "ebass", m - 12 if m > 52 else m, E.BEAT * 0.8, 0.65 if bt % 2 == 0 else 0.55)
        if lv("drums", bar) > 0:
            pattern(dr, bar, "X-------X-------", lambda i: kick(56.0, 60.0, 0.03, 0.18, 0.3, 1.5), 0.65, kick=True)
            pattern(dr, bar, "----X-------X---", lambda i: tone_hit(400.0, 0.05, 0.15, 0.01, ((1, 1.0), (2.2, 0.4)), 1.6, 3500, i % 3), 0.42, 0.1)
            pattern(dr, bar, "x-x-x-x-x-x-x-x-", lambda i: hat(i % 4), 0.14, -0.2)
            if bar % 8 == 7:
                pattern(dr, bar, "------------xxxx", lambda i: tone_hit(400.0 - 30 * (i - 12), 0.05, 0.15, 0.01, ((1, 1.0),), 1.4, 3000, i % 3), 0.3)
    brass_line(br, 16, 48, [601, 602, 603, 604], 0.42)
    brass_line(br, 96, 16, [605, 606], 0.32)
    brass_line(br, 112, 60, [601, 602, 603, 604, 607, 608], 0.44)
    for p in range(8):
        for bar, beat, m, d in phrase(611 + p % 4, BR[(p + 1) % 2], 74, 69, 86, CH, SC, bar0=64 + 4 * p):
            cl.note(tb(bar, beat), "clarinet", m, d * E.BEAT * 0.9, 0.45)
    return [sk, org, bass, dr, br, cl]


if __name__ == "__main__":
    sys.exit(E.run(build))
