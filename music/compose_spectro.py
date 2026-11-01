#!/usr/bin/env python3
"""'분광 분석'(Spectral Scan) — 복셀 연구소(Voxel Lab) 활발(2단계) 배경음악.

활발 · 스펙트럼을 훑는 분광기 — 3:4 폴리리듬 겹 아르페지오, 하프타임 스네어와 셰이커, 옥타브 베이스, 비브라폰 모티프.
112 BPM 4/4 140마디 = 정확히 300초, G dorian(Gm9–C9–Ebmaj7–F6). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～12) → 전개(12～48) → 고조(48～92) → 브레이크(92～104) → 흐름(104～128) → 아웃트로(128～140)

  python music/compose_spectro.py --out <폴더>/bgm-spectro.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("spectro", "분광 분석",
        "활발 · 스펙트럼을 훑는 분광기 — 3:4 폴리리듬 겹 아르페지오, 하프타임 스네어와 셰이커, 옥타브 베이스, 비브라폰 모티프",
        "G dorian", 112, [
            {"n": "인트로", "part": "기", "bars": 12, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.4, "gear": 0.8, "mel": 0.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 36, "pad": 0.8, "arp": 1.0, "arp2": 0.7, "drums": 1.0, "hat": 0.8, "bass": 1.0, "gear": 1.0, "mel": 0.5, "filt": 0.55},
            {"n": "고조", "part": "전", "bars": 44, "pad": 0.7, "arp": 1.0, "arp2": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "mel": 1.0, "filt": 0.9},
            {"n": "브레이크", "part": "전", "bars": 12, "pad": 1.0, "arp": 0.8, "arp2": 1.0, "drums": 0.0, "hat": 0.3, "bass": 0.4, "gear": 1.0, "mel": 0.6, "filt": 0.45},
            {"n": "흐름", "part": "전", "bars": 24, "pad": 0.8, "arp": 1.0, "arp2": 0.8, "drums": 1.0, "hat": 0.9, "bass": 1.0, "gear": 1.0, "mel": 0.7, "filt": 0.7},
            {"n": "아웃트로", "part": "결", "bars": 12, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.4, "gear": 0.8, "mel": 0.0, "filt": 0.3},
        ], stage=2, energy=0.6, reverb=(2.8, 2.2, 0.8), wet=0.32, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["Gm9", "C9", "Ebmaj7", "F6"], "per": 2, "scale": [7, "dorian"], "arp": {"kind": "saw", "rate": 4, "shape": "up", "lo": 62, "hi": 79, "v": 0.2, "fc": 2600, "gate": 0.5, "sw_lo": 600, "sw_hi": 6000, "accent": 4}, "arp2": {"kind": "square", "rate": 1.3333333333333333, "shape": "down", "lo": 70, "hi": 89, "v": 0.15, "fc": 3200, "gate": 0.6, "echo": 0.55, "pan": -0.2}, "drums": "half", "bass": "octave", "gear": ["geiger", "drip"], "geiger_rate": 4, "drips": 2, "mel": {"inst": "vibes", "lo": 67, "hi": 86, "v": 0.24}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
