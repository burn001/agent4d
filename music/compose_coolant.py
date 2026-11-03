#!/usr/bin/env python3
"""'냉각수 순환'(Coolant Loop) — 복셀 연구소(Voxel Lab) 보통(1단계) 배경음악.

보통 · 6/8 흔들림 — 오르골 8분 분산화음, 1·4 흔들리는 킥과 림, 셰이커, 60Hz 험과 물방울, 첼로 선율.
168 BPM 6/8(박 = 8분음표) 140마디 = 정확히 300초, G major(Gmaj9–Em9–Cmaj7#11–D6). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～16) → 전개(16～56) → 선율(56～100) → 정리(100～124) → 아웃트로(124～140)

  python music/compose_coolant.py --out <폴더>/bgm-coolant.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("coolant", "냉각수 순환",
        "보통 · 6/8 흔들림 — 오르골 8분 분산화음, 1·4 흔들리는 킥과 림, 셰이커, 60Hz 험과 물방울, 첼로 선율",
        "G major", 168, [
            {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 40, "pad": 0.9, "arp": 1.0, "drums": 1.0, "hat": 0.7, "bass": 1.0, "gear": 1.0, "mel": 0.0, "filt": 0.5},
            {"n": "선율", "part": "전", "bars": 44, "pad": 0.9, "arp": 0.9, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 0.8, "mel": 1.0, "filt": 0.7},
            {"n": "정리", "part": "결", "bars": 24, "pad": 1.0, "arp": 1.0, "drums": 0.6, "hat": 0.4, "bass": 0.8, "gear": 1.0, "mel": 0.4, "filt": 0.45},
            {"n": "아웃트로", "part": "결", "bars": 16, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
        ], stage=1, energy=0.3, beats=6, reverb=(3.2, 2.6, 1.0), wet=0.4, echo_beats=3.0, master_lp=10500)

CFG = {"prog": ["Gmaj9", "Em9", "Cmaj7#11", "D6"], "per": 2, "scale": [7, "major"], "arp": {"kind": "musicbox", "rate": 1, "shape": "updown", "lo": 67, "hi": 88, "v": 0.26, "echo": 0.35, "gate": 1.2, "accent": 6, "gain": 1.1}, "drums": "sway", "bass": "long", "gear": ["hum", "drip", "geiger"], "drips": 2, "geiger_rate": 1, "hum_gain": 0.03, "hum_hz": 60.0, "mel": {"inst": "cello", "lo": 50, "hi": 66, "v": 0.3, "slot_beats": 1.0, "pan": -0.15}, "pad": {"v": 0.11}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
