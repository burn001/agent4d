#!/usr/bin/env python3
"""'임계 반응로'(Reactor Critical) — 복셀 연구소(Voxel Lab) 매우 활발(3단계) 배경음악.

매우 활발 · 임계에 다가가는 반응로 — 몰아치는 킥과 16분 하이햇, 두 겹 시퀀서 아르페지오, 잡음 상승, 회전음과 가이거 틱.
136 BPM 4/4 170마디 = 정확히 300초, F minor(Fm9–Dbmaj7–Ab6–C7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～16) → 빌드업(16～48) → 클라이맥스(48～96) → 브레이크다운(96～112) → 드롭(112～154) → 아웃트로(154～170)

  python music/compose_reactor.py --out <폴더>/bgm-reactor.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("reactor", "임계 반응로",
        "매우 활발 · 임계에 다가가는 반응로 — 몰아치는 킥과 16분 하이햇, 두 겹 시퀀서 아르페지오, 잡음 상승, 회전음과 가이거 틱",
        "F minor", 136, [
            {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.0, "gear": 0.8, "filt": 0.35},
            {"n": "빌드업", "part": "승", "bars": 32, "pad": 0.7, "arp": 1.0, "arp2": 0.6, "drums": 1.0, "hat": 0.8, "bass": 1.0, "gear": 1.0, "filt": 0.6},
            {"n": "클라이맥스", "part": "전", "bars": 48, "pad": 0.6, "arp": 1.0, "arp2": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "filt": 0.95},
            {"n": "브레이크다운", "part": "전", "bars": 16, "pad": 1.0, "arp": 0.8, "arp2": 1.0, "drums": 0.0, "hat": 0.4, "bass": 0.0, "gear": 1.0, "filt": 0.45},
            {"n": "드롭", "part": "전", "bars": 42, "pad": 0.6, "arp": 1.0, "arp2": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "filt": 0.9},
            {"n": "아웃트로", "part": "결", "bars": 16, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.0, "gear": 0.8, "filt": 0.35},
        ], stage=3, energy=0.86, reverb=(2.4, 1.8, 0.7), wet=0.28, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["Fm9", "Dbmaj7", "Ab6", "C7sus"], "per": 2, "scale": [5, "minor"], "arp": {"kind": "saw", "rate": 4, "shape": "leap", "lo": 60, "hi": 79, "v": 0.2, "fc": 3200, "gate": 0.42, "sw_lo": 600, "sw_hi": 7000, "accent": 3}, "arp2": {"kind": "square", "rate": 2, "shape": "updown", "lo": 72, "hi": 88, "v": 0.14, "fc": 3500, "gate": 0.5, "echo": 0.5, "pan": 0.2}, "drums": "drive", "bass": "pulse8", "gear": ["whir", "geiger"], "whir_hz": 1200, "whir_rate": 8, "whir_gain": 0.05, "geiger_rate": 6}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
