#!/usr/bin/env python3
"""'금요일 맘보' — 복셀(카페·사무실) 매우 활발(3단계) 배경음악.

빠른 맘보·살사: 엇박으로 당기는 피아노 몬투노(옥타브), 2박 뒤·4박에 오는 툼바오 베이스, 3-2 손 클라베, 콩가(열린 소리·슬랩),
4분 카우벨, 팀발레 필, 금관·색소폰 섹션 주제. 184 BPM 4/4 230마디 = 정확히 300초,
C minor(Cm–Fm–Bb7–Ebmaj7–Abmaj7–Fm–Dm7b5–G7–Cm–G7). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～16) → A(16～80) 금관 → B(80～128) 색소폰 → 브레이크(128～144) → 클라이맥스(144～214) → 아웃트로(214～230)

  python music/compose_mambo.py --out <폴더>/bgm-mambo.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pattern, voicing, scale_of, bass_note, step_in, kick, tone_hit, shaker, phrase

E.setup("mambo", "금요일 맘보",
        "매우 활발 · 빠른 맘보·살사 — 피아노 몬투노, 툼바오 베이스, 3-2 클라베, 콩가·카우벨·팀발레, 금관·색소폰 주제",
        "C minor", 184, [
            {"n": "인트로", "part": "기", "bars": 16, "piano": 1.0, "bass": 1.0, "perc": 0.8, "bell": 0.6, "brass": 0.0, "sax": 0.0, "shk": 0.6},
            {"n": "A", "part": "승", "bars": 64, "piano": 1.0, "bass": 1.0, "perc": 1.0, "bell": 1.0, "brass": 1.0, "sax": 0.0, "shk": 1.0},
            {"n": "B", "part": "전", "bars": 48, "piano": 0.9, "bass": 1.0, "perc": 1.0, "bell": 1.0, "brass": 0.4, "sax": 1.0, "shk": 1.0},
            {"n": "브레이크", "part": "전", "bars": 16, "piano": 1.0, "bass": 0.7, "perc": 1.0, "bell": 0.3, "brass": 0.0, "sax": 0.5, "shk": 0.5},
            {"n": "클라이맥스", "part": "전", "bars": 70, "piano": 1.0, "bass": 1.0, "perc": 1.0, "bell": 1.0, "brass": 1.0, "sax": 0.7, "shk": 1.0},
            {"n": "아웃트로", "part": "결", "bars": 16, "piano": 1.0, "bass": 1.0, "perc": 0.8, "bell": 0.6, "brass": 0.0, "sax": 0.0, "shk": 0.6},
        ], stage=3, energy=0.94, reverb=(1.7, 1.3, 0.5), wet=0.22, master_lp=11000, hi_shelf=-4.5)

CH = prog_at(["Cm", "Fm", "Bb7", "Ebmaj7", "Abmaj7", "Fm", "Dm7b5", "G7", "Cm", "G7"], per=1)
SC = scale_of(0, "minor")
MONT = [0.0, 0.5, 1.5, 2.0, 3.0, 3.5]         # 몬투노 당김 자리
BR = [[(0, 1), (1, 2), (3, 1), (4, 2), (6, 2), (8, 1), (9, 1), (10, 2), (12, 4), (16, 1), (17, 2), (19, 1), (20, 4), (24, 2), (26, 2), (28, 4)],
      [(1, 1), (2, 1), (3, 2), (5, 1), (6, 2), (8, 6), (16, 1), (17, 1), (18, 1), (19, 2), (21, 1), (22, 2), (24, 8)]]


def build():
    pn = Layer("piano", dry=0.7, rev=0.25, hp=150, lp=6500, tau=1.0, gain=0.7)
    bass = Layer("bass", dry=1.0, rev=0.05, lp=1400, tau=1.0, gain=0.5)
    pc = Layer("perc", dry=0.75, rev=0.2, hp=120, lp=9000, tau=1.0)
    bl = Layer("bell", dry=0.6, rev=0.15, hp=500, lp=8000, tau=1.0, gain=1.6)
    br = Layer("brass", dry=0.6, rev=0.3, hp=250, lp=5000, tau=1.0)
    sx = Layer("sax", dry=0.6, rev=0.3, hp=200, lp=5000, tau=1.5)
    sk = Layer("shk", dry=0.55, rev=0.1, hp=4500, tau=1.0, gain=2.0)
    conga_o = lambda i: tone_hit(330.0, 0.09, 0.15, 0.01, ((1, 1.0), (1.5, 0.25)), 0.25, 2000, i % 3)
    conga_l = lambda i: tone_hit(220.0, 0.12, 0.15, 0.01, ((1, 1.0), (1.5, 0.2)), 0.2, 1500, i % 3)
    slap = lambda i: tone_hit(420.0, 0.03, 0.1, 0.01, ((1, 0.6), (2.3, 0.4)), 1.6, 4000, i % 3)
    for bar in range(E.BARS):
        ch = CH(bar)
        vo = voicing(ch, 62, 74, None, maxn=3)
        top = vo[-1]
        for k, bt in enumerate(MONT):
            m = top if k % 2 == 0 else vo[k % len(vo)]
            for o in (0, -12):
                pn.note(tb(bar, bt), "piano", m + o, E.BEAT * 0.4, 0.38 if o == 0 else 0.3, pan=0.15)
            if k in (1, 4):
                for mm in vo[:-1]:
                    pn.note(tb(bar, bt) + 0.005, "piano", mm, E.BEAT * 0.4, 0.22, pan=0.15)
        b = bass_note(ch, 36)
        nb = bass_note(CH(bar + 1), 36)
        bass.note(tb(bar, 1.5), "upright", b, E.BEAT * 1.4, 0.75)
        bass.note(tb(bar, 3.0), "upright", nb if bar % 2 else b + 7 - (12 if b + 7 > 47 else 0), E.BEAT * 0.9, 0.7)
        pattern(pc, bar, "--o---X---o-X-x-", conga_o, 0.4, 0.3)
        pattern(pc, bar, "------------x-X-" if bar % 2 else "--------x-----X-", conga_l, 0.4, 0.4)
        pattern(pc, bar, "----x-------x---", slap, 0.35, 0.25)
        clave = (0, 1.5, 3) if bar % 2 == 0 else (1, 2)
        for bt in clave:
            pc.hit(tb(bar, bt), tone_hit(2300.0, 0.03, 0.0, 0.01, ((1, 1.0), (2.7, 0.2))), 0.32, pan=-0.4)
        if lv("perc", bar) > 0:
            pattern(pc, bar, "X-------X-------", lambda i: kick(60.0, 40.0, 0.03, 0.15, 0.1, 1.3), 0.4, kick=True)
        if bar % 8 == 7:
            pattern(pc, bar, "--------xxx-xxx-", lambda i: tone_hit(500.0 - 25 * (i - 8), 0.06, 0.1, 0.01, ((1, 1.0), (1.8, 0.4)), 0.8, 3000, i % 3), 0.38, -0.3)
        for bt in range(4):
            bl.hit(tb(bar, bt), tone_hit(800.0, 0.06, 0.0, 0.01, ((1, 1.0), (1.48, 0.8))), 0.3 if bt % 2 == 0 else 0.22, pan=0.45)
        pattern(sk, bar, "x-x-x-x-x-x-x-x-", lambda i: shaker(i % 4), 0.18, -0.3)
    for b0, nb, seeds, L, inst_, harm in ((16, 64, [901, 902, 903, 904], br, "brass", True), (144, 68, [901, 902, 905, 906, 903, 907], br, "brass", True),
                                          (80, 48, [911, 912, 913, 914], sx, "sax", False), (128, 16, [915, 916], sx, "sax", False)):
        for p in range(nb // 4):
            for bar, beat, m, d in phrase(seeds[p % len(seeds)], BR[p % 2], 74, 67, 82, CH, SC, bar0=b0 + 4 * p):
                L.note(tb(bar, beat), inst_, m, d * E.BEAT * 0.85, 0.42, pan=0.1)
                if harm:
                    L.note(tb(bar, beat) + 0.005, "brassd", step_in(m, -2, SC), d * E.BEAT * 0.85, 0.3, pan=-0.1)
    return [pn, bass, pc, bl, br, sx, sk]


if __name__ == "__main__":
    sys.exit(E.run(build))
