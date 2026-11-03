#!/usr/bin/env python3
"""'현미경 관찰'(Under the Microscope) — 복셀 연구소(Voxel Lab) 보통(1단계) 배경음악.

보통 · 3/4 연구소 왈츠 — 마림바 분산화음, 1박 킥과 2·3박 림, 셰이커, 피펫 물방울, 모니터 삐 소리, 플루트 선율.
84 BPM 3/4 140마디 = 정확히 300초, B minor(Bm9–Gmaj7–Em9–F#7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～16) → 전개(16～56) → 선율(56～100) → 정리(100～126) → 아웃트로(126～140)

  python music/compose_microscope.py --out <폴더>/bgm-microscope.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("microscope", "현미경 관찰",
        "보통 · 3/4 연구소 왈츠 — 마림바 분산화음, 1박 킥과 2·3박 림, 셰이커, 피펫 물방울, 모니터 삐 소리, 플루트 선율",
        "B minor", 84, [
            {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 40, "pad": 0.9, "arp": 1.0, "drums": 1.0, "hat": 0.7, "bass": 1.0, "gear": 1.0, "mel": 0.0, "filt": 0.5},
            {"n": "선율", "part": "전", "bars": 44, "pad": 0.9, "arp": 0.9, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 0.8, "mel": 1.0, "filt": 0.7},
            {"n": "정리", "part": "결", "bars": 26, "pad": 1.0, "arp": 1.0, "drums": 0.6, "hat": 0.4, "bass": 0.8, "gear": 1.0, "mel": 0.4, "filt": 0.45},
            {"n": "아웃트로", "part": "결", "bars": 14, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
        ], stage=1, energy=0.34, beats=3, reverb=(3.0, 2.4, 0.9), wet=0.38, echo_beats=1.5, master_lp=11000)

CFG = {"prog": ["Bm9", "Gmaj7", "Em9", "F#7sus"], "per": 2, "scale": [11, "minor"], "arp": {"kind": "marimba", "rate": 2, "shape": [0, 2, 1, 3, 2, 1], "lo": 59, "hi": 78, "v": 0.34, "echo": 0.35, "gate": 0.9, "gain": 1.1}, "drums": "waltz", "bass": "long", "gear": ["drip", "beep"], "drips": 2, "beep_m": 90, "beep_every": 4, "mel": {"inst": "flute", "lo": 66, "hi": 83, "v": 0.26}, "pad": {"v": 0.11}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
