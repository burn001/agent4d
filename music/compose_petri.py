#!/usr/bin/env python3
"""'배양 접시'(Petri Dish) — 복셀 연구소(Voxel Lab) 한가(0단계) 배경음악.

한가 · 배양기 곁의 잔잔한 전자음 — 칼림바 아르페지오, 가이거 계수기 틱, 물방울, 부드러운 패드와 서브 베이스.
72 BPM 4/4 90마디 = 정확히 300초, E dorian(Em9–A9–Cmaj7–D6). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～14) → 전개(14～42) → 모티프(42～76) → 아웃트로(76～90)

  python music/compose_petri.py --out <폴더>/bgm-petri.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("petri", "배양 접시",
        "한가 · 배양기 곁의 잔잔한 전자음 — 칼림바 아르페지오, 가이거 계수기 틱, 물방울, 부드러운 패드와 서브 베이스",
        "E dorian", 72, [
            {"n": "인트로", "part": "기", "bars": 14, "pad": 1.0, "arp": 0.6, "gear": 0.7, "bass": 0.4, "mel": 0.0, "filt": 0.25},
            {"n": "전개", "part": "승", "bars": 28, "pad": 0.9, "arp": 1.0, "gear": 1.0, "bass": 1.0, "mel": 0.5, "filt": 0.5},
            {"n": "모티프", "part": "전", "bars": 34, "pad": 0.9, "arp": 1.0, "gear": 0.9, "bass": 1.0, "mel": 1.0, "filt": 0.7},
            {"n": "아웃트로", "part": "결", "bars": 14, "pad": 1.0, "arp": 0.6, "gear": 0.7, "bass": 0.4, "mel": 0.0, "filt": 0.25},
        ], stage=0, energy=0.2, reverb=(3.8, 3.0, 1.2), wet=0.45, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["Em9", "A9", "Cmaj7", "D6"], "per": 2, "scale": [4, "dorian"], "arp": {"kind": "kalimba", "gain": 0.75, "rate": 2, "shape": [0, 2, 1, 3, 2, 4, 3, 1], "lo": 64, "hi": 83, "v": 0.36, "echo": 0.5, "gate": 0.9}, "drums": "none", "bass": "long", "gear": ["geiger", "drip"], "geiger_rate": 2, "drips": 2, "mel": {"inst": "vibes", "lo": 67, "hi": 83, "v": 0.22}, "pad": {"v": 0.11}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
