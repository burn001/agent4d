#!/usr/bin/env python3
"""'빙하 위의 코드' — 흐름(Intense 코딩) 한가(0단계) 배경음악.

미니멀 글리치 앰비언트: 유리 같은 FM 키, 16분 격자 위 성긴 마이크로 클릭, 서브 드론, 1박에만 오는 여린 심장 킥.
68 BPM 4/4 85마디 = 정확히 300초, B minor(Bm9–Gmaj9–Em9–F#m7). 시드 2026 결정적 합성, 공용 엔진 bgmkit.
  인트로(0～12) 패드·클릭 → 전개(12～36) 키 선율·서브 → 흐름(36～60) 킥·클릭 촘촘 → 잦아듦(60～73) → 아웃트로(73～85) 처음 상태

  python music/compose_glacier.py --out <폴더>/bgm-glacier.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
from bgmkit import Layer, tb, lv, prog_at, pads, melody, scale_of, noise_hit, kick, sub_note, bell, bass_note

E.setup("glacier", "빙하 위의 코드",
        "한가 · 미니멀 글리치 앰비언트 — 유리 같은 FM 키, 성긴 마이크로 클릭, 서브 드론, 여린 심장 킥",
        "B minor", 68, [
            {"n": "인트로", "part": "기", "bars": 12, "pad": 1.0, "click": 0.5, "keys": 0.0, "sub": 0.4, "kick": 0.0, "glass": 0.6, "filt": 0.2},
            {"n": "전개", "part": "승", "bars": 24, "pad": 1.0, "click": 0.8, "keys": 1.0, "sub": 1.0, "kick": 0.0, "glass": 0.3, "filt": 0.4},
            {"n": "흐름", "part": "전", "bars": 24, "pad": 0.9, "click": 1.0, "keys": 0.9, "sub": 1.0, "kick": 1.0, "glass": 0.6, "filt": 0.6},
            {"n": "잦아듦", "part": "전", "bars": 13, "pad": 1.0, "click": 0.7, "keys": 0.6, "sub": 0.8, "kick": 0.5, "glass": 1.0, "filt": 0.35},
            {"n": "아웃트로", "part": "결", "bars": 12, "pad": 1.0, "click": 0.5, "keys": 0.0, "sub": 0.4, "kick": 0.0, "glass": 0.6, "filt": 0.2},
        ], stage=0, energy=0.18, reverb=(5.5, 4.0, 1.6), wet=0.5, echo_beats=0.75, master_lp=11000)

CH = prog_at(["Bm9", "Gmaj9", "Em9", "F#m7"], per=2)
SC = scale_of(11, "minor")
SLOTS = [[(0, 6), (6, 2), (8, 8), (20, 4), (24, 8)], [(2, 4), (8, 4), (12, 4), (16, 10), (28, 4)]]


def build():
    pad = Layer("pad", dry=0.6, rev=0.55, hp=110, sweep=(500, 2600), width=1.3, tau=4.0)
    click = Layer("click", dry=0.7, rev=0.2, echo=0.35, hp=2500, tau=2.0, gain=5.0)
    keys = Layer("keys", dry=0.5, rev=0.5, echo=0.3, lp=5200, hp=200, tau=3.0)
    sub = Layer("sub", dry=1.0, rev=0.0, lp=200, tau=3.0, duck=0.2)
    kk = Layer("kick", dry=1.0, rev=0.06, lp=900, tau=1.0)
    glass = Layer("glass", dry=0.35, rev=0.7, echo=0.4, lp=7000, hp=600, tau=4.0, gain=2.0)
    pads(pad, CH, 59, 76, every=2, v=0.2, a=2.2, rel=3.0, cents=8)
    for bar in range(0, E.BARS, 2):
        sub.add(tb(bar), sub_note(bass_note(CH(bar), 35), 2 * E.BAR - 0.2, a=0.4, rel=0.6, h2=0.05), 0.24)
    r = E.np.random.default_rng(68)
    probs = [0.55, 0.1, 0.25, 0.15, 0.4, 0.1, 0.3, 0.2, 0.5, 0.1, 0.25, 0.15, 0.4, 0.2, 0.3, 0.35]
    pat = [[i for i in range(16) if r.random() < probs[i]] for _ in range(8)]
    for bar in range(E.BARS):
        for i in pat[bar % 8]:
            click.hit(tb(bar, i / 4), noise_hit(i % 5, 0.003 + 0.002 * (i % 3), 6000 + 900 * (i % 4), 1.5, 14000),
                      0.32 * (1.0 if i % 4 == 0 else 0.6), pan=((i * 7) % 9 - 4) / 5)
        if lv("kick", bar) > 0:
            kk.kick(tb(bar), kick(46.0, 50.0, 0.03, 0.28, 0.0, 1.2), 0.45)
        if bar % 4 == 2:
            m = 83 + [0, 2, 3, 7][(bar // 4) % 4]
            glass.add(tb(bar, 1.5), bell(m, 3.0, 0.7, 3.5), 0.5, pan=0.4 if bar % 8 == 2 else -0.4)
    melody(keys, "epiano", 12, 64, [101, 102, 103, 104], SLOTS, CH, SC, 0.55, pan=0.15, lo=62, hi=79, legato=1.4)
    return [pad, click, keys, sub, kk, glass]


if __name__ == "__main__":
    sys.exit(E.run(build))
