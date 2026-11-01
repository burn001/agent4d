#!/usr/bin/env python3
"""'적정 실험'(Titration) — 복셀 연구소(Voxel Lab) 보통(1단계) 배경음악.

보통 · 한 방울씩 떨어지는 적정 — 부드러운 킥과 림, 피펫 물방울 리듬, 필터가 천천히 열리는 톱니 아르페지오, 비브라폰.
92 BPM 4/4 115마디 = 정확히 300초, F lydian(Fmaj9–G6–Em7–Am9). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～12) → 전개(12～48) → 모티프(48～84) → 브레이크(84～96) → 흐름(96～103) → 아웃트로(103～115)

  python music/compose_titration.py --out <폴더>/bgm-titration.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("titration", "적정 실험",
        "보통 · 한 방울씩 떨어지는 적정 — 부드러운 킥과 림, 피펫 물방울 리듬, 필터가 천천히 열리는 톱니 아르페지오, 비브라폰",
        "F lydian", 92, [
            {"n": "인트로", "part": "기", "bars": 12, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.25},
            {"n": "전개", "part": "승", "bars": 36, "pad": 0.8, "arp": 1.0, "drums": 1.0, "hat": 0.7, "bass": 1.0, "gear": 1.0, "mel": 0.4, "filt": 0.5},
            {"n": "모티프", "part": "전", "bars": 36, "pad": 0.8, "arp": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 0.9, "mel": 1.0, "filt": 0.8},
            {"n": "브레이크", "part": "전", "bars": 12, "pad": 1.0, "arp": 0.8, "drums": 0.0, "hat": 0.3, "bass": 0.5, "gear": 1.0, "mel": 0.5, "filt": 0.4},
            {"n": "흐름", "part": "전", "bars": 7, "pad": 0.9, "arp": 1.0, "drums": 1.0, "hat": 0.8, "bass": 1.0, "gear": 1.0, "mel": 0.6, "filt": 0.6},
            {"n": "아웃트로", "part": "결", "bars": 12, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.25},
        ], stage=1, energy=0.38, reverb=(3.0, 2.4, 0.9), wet=0.35, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["Fmaj9", "G6", "Em7", "Am9"], "per": 2, "scale": [5, "lydian"], "arp": {"kind": "saw", "rate": 2, "shape": "up", "lo": 65, "hi": 84, "v": 0.26, "fc": 2400, "gate": 0.55, "sw_lo": 600, "sw_hi": 5500}, "drums": "soft", "bass": "long", "gear": ["drip", "hum"], "drips": 4, "hum_gain": 0.035, "mel": {"inst": "vibes", "lo": 69, "hi": 86, "v": 0.24}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
