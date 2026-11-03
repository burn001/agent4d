#!/usr/bin/env python3
"""'공원 벤치'(Park Bench) — 복셀(카페·사무실) 보통(1단계) 배경음악.

6/8 민속풍 산책: 나일론 기타 8분 분산화음, 점4분 업라이트 베이스, 프레임 드럼 같은 여린 킥과 탬버린 셰이커,
아코디언 주제, B 구간 플루트 대선율. 180 BPM(8분음표) 6/8 150마디 = 정확히 300초,
E major(E–C#m7–A–B7–E–G#m7–A–B7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) → A(12～52) 아코디언 → B(52～92) 플루트 → A · 다시(92～128) → 정리(128～138) → 아웃트로(138～150)

  python music/compose_parkbench.py --out <폴더>/bgm-parkbench.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, melody, voicing, scale_of, kick, shaker, bass_note

E.setup("parkbench", "공원 벤치",
        "보통 · 6/8 민속풍 산책 — 나일론 기타 8분 분산화음, 점4분 업라이트 베이스, 여린 프레임 드럼과 탬버린, 아코디언 주제, 플루트 대선율",
        "E major", 180, [
            {"n": "인트로", "part": "기", "bars": 12, "gtr": 1.0, "bass": 0.6, "perc": 0.0, "acc": 0.0, "flute": 0.0},
            {"n": "A", "part": "승", "bars": 40, "gtr": 1.0, "bass": 1.0, "perc": 1.0, "acc": 1.0, "flute": 0.0},
            {"n": "B", "part": "전", "bars": 40, "gtr": 0.9, "bass": 1.0, "perc": 1.0, "acc": 0.3, "flute": 1.0},
            {"n": "A · 다시", "part": "전", "bars": 36, "gtr": 1.0, "bass": 1.0, "perc": 1.0, "acc": 1.0, "flute": 0.3},
            {"n": "정리", "part": "결", "bars": 10, "gtr": 1.0, "bass": 0.8, "perc": 0.5, "acc": 0.4, "flute": 0.0},
            {"n": "아웃트로", "part": "결", "bars": 12, "gtr": 1.0, "bass": 0.6, "perc": 0.0, "acc": 0.0, "flute": 0.0},
        ], stage=1, energy=0.42, beats=6, reverb=(2.2, 1.7, 0.7), wet=0.28, echo_beats=3.0, master_lp=10000, hi_shelf=-4.0)

CH = prog_at(["E", "C#m7", "A", "B7", "E", "G#m7", "A", "B7sus"], per=2)
SC = scale_of(4, "major")
AC = [[(0, 2), (2, 1), (3, 3), (6, 2), (8, 1), (9, 3), (12, 3), (15, 3), (18, 6)],
      [(0, 3), (3, 1), (4, 2), (6, 3), (9, 3), (12, 2), (14, 1), (15, 3), (18, 6)]]
FL = [[(0, 6), (6, 3), (9, 3), (12, 6), (18, 6)], [(3, 3), (6, 6), (12, 3), (15, 3), (18, 6)]]


def build():
    gtr = Layer("gtr", dry=0.75, rev=0.3, lp=6500, hp=80, tau=2.0)
    bs = Layer("bass", dry=0.85, rev=0.2, lp=2500, hp=35, tau=2.0)
    pc = Layer("perc", dry=0.7, rev=0.25, lp=9000, tau=1.5)
    ac = Layer("acc", dry=0.55, rev=0.4, lp=5500, hp=200, tau=3.0)
    fl = Layer("flute", dry=0.5, rev=0.5, lp=7000, hp=300, tau=3.0)
    for bar in range(E.BARS):
        ch = CH(bar)
        b = bass_note(ch, 40)
        up = voicing(ch, 59, 76, None, rootless=True, maxn=3)
        notes = [b, up[0], up[1 % len(up)], up[-1], up[1 % len(up)], up[0]]
        for i, m in enumerate(notes):
            gtr.note(tb(bar, i), "nylon", m, E.BEAT * (3.0 if i == 0 else 1.6), 0.42 if i == 0 else (0.3 if i == 3 else 0.24), pan=-0.2)
        r = bass_note(ch, 28)
        bs.note(tb(bar), "upright", r, E.BEAT * 2.6, 0.5)
        bs.note(tb(bar, 3), "upright", r + 7, E.BEAT * 2.4, 0.4)
        if lv("perc", bar) > 0:
            pc.kick(tb(bar), kick(60.0, 40.0, 0.03, 0.18, 0.0, 1.1), 0.32, duck=False)
            for i in range(6):
                pc.hit(tb(bar, i), shaker(i % 4), 0.2 if i == 3 else 0.1, pan=0.35)
    melody(ac, "accordion", 12, 40, [701, 702, 703, 704], AC, CH, SC, 0.4, 0.15, lo=64, hi=81, slot_beats=1.0, legato=0.9)
    melody(fl, "flute", 52, 40, [711, 712, 713, 714, 715], FL, CH, SC, 0.42, -0.2, lo=71, hi=88, slot_beats=1.0, legato=1.0)
    melody(ac, "accordion", 52, 40, [705, 706], AC, CH, SC, 0.22, 0.15, lo=62, hi=76, slot_beats=1.0, legato=0.9)
    melody(ac, "accordion", 92, 36, [701, 702, 703, 704], AC, CH, SC, 0.4, 0.15, lo=64, hi=81, slot_beats=1.0, legato=0.9)
    melody(ac, "accordion", 128, 8, [707, 708], AC, CH, SC, 0.28, 0.15, lo=64, hi=79, slot_beats=1.0, legato=0.9)
    return [gtr, bs, pc, ac, fl]


if __name__ == "__main__":
    sys.exit(E.run(build))
