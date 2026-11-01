#!/usr/bin/env python3
"""'오실로스코프'(Oscilloscope) — 복셀 연구소(Voxel Lab) 보통(1단계) 배경음악.

보통 · 오실로스코프 파형처럼 흐르는 하프타임 일렉트로닉 — 사각파 아르페지오, 3:4 블립 겹 아르페지오, 계전기 딸깍, 모니터 삐 소리.
104 BPM 4/4 130마디 = 정확히 300초, D minor(Dm9–Bbmaj7–Gm9–A7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～14) → 전개(14～50) → 고조(50～86) → 브레이크(86～100) → 흐름(100～116) → 아웃트로(116～130)

  python music/compose_oscillo.py --out <폴더>/bgm-oscillo.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("oscillo", "오실로스코프",
        "보통 · 오실로스코프 파형처럼 흐르는 하프타임 일렉트로닉 — 사각파 아르페지오, 3:4 블립 겹 아르페지오, 계전기 딸깍, 모니터 삐 소리",
        "D minor", 104, [
            {"n": "인트로", "part": "기", "bars": 14, "pad": 1.0, "arp": 0.6, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.7, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 36, "pad": 0.8, "arp": 1.0, "arp2": 0.6, "drums": 1.0, "hat": 0.7, "bass": 1.0, "gear": 1.0, "filt": 0.5},
            {"n": "고조", "part": "전", "bars": 36, "pad": 0.8, "arp": 1.0, "arp2": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "filt": 0.85},
            {"n": "브레이크", "part": "전", "bars": 14, "pad": 1.0, "arp": 0.8, "arp2": 1.0, "drums": 0.0, "hat": 0.3, "bass": 0.5, "gear": 1.0, "filt": 0.45},
            {"n": "흐름", "part": "전", "bars": 16, "pad": 0.8, "arp": 1.0, "arp2": 0.7, "drums": 1.0, "hat": 0.8, "bass": 1.0, "gear": 1.0, "filt": 0.6},
            {"n": "아웃트로", "part": "결", "bars": 14, "pad": 1.0, "arp": 0.6, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.7, "filt": 0.3},
        ], stage=1, energy=0.48, reverb=(3.2, 2.6, 1.0), wet=0.38, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["Dm9", "Bbmaj7", "Gm9", "A7sus"], "per": 2, "scale": [2, "minor"], "arp": {"kind": "square", "rate": 4, "shape": "leap", "lo": 62, "hi": 81, "v": 0.2, "fc": 2200, "gate": 0.5, "sw_lo": 500, "sw_hi": 5000}, "arp2": {"kind": "blip", "rate": 1.3333333333333333, "shape": "up", "lo": 74, "hi": 93, "v": 0.24, "echo": 0.6, "gate": 0.4, "pan": 0.2}, "drums": "half", "bass": "octave", "gear": ["relay", "beep"], "relay_pat": "x--x--x---x-x---", "beep_m": 93}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
