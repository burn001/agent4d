#!/usr/bin/env python3
"""'전기영동'(Gel Run) — 복셀 연구소(Voxel Lab) 활발(2단계) 배경음악.

활발 · 브레이크비트 실험실 — 엇박 킥과 고스트 스네어, 공명 짙은 16분 톱니 시퀀서, 긴 서브 베이스, 계전기·모니터 삐 소리, 오르간 선율.
128 BPM 4/4 160마디 = 정확히 300초, Bb minor(Bbm9–Gbmaj7–Ebm9–F7sus). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～16) → 전개(16～64) → 선율(64～112) → 브레이크(112～128) → 다시(128～144) → 아웃트로(144～160)

  python music/compose_gelrun.py --out <폴더>/bgm-gelrun.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("gelrun", "전기영동",
        "활발 · 브레이크비트 실험실 — 엇박 킥과 고스트 스네어, 공명 짙은 16분 톱니 시퀀서, 긴 서브 베이스, 계전기·모니터 삐 소리, 오르간 선율",
        "Bb minor", 128, [
            {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.6, "drums": 0.0, "hat": 0.5, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 48, "pad": 0.8, "arp": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "mel": 0.0, "filt": 0.55},
            {"n": "선율", "part": "전", "bars": 48, "pad": 0.8, "arp": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 0.9, "mel": 1.0, "filt": 0.8},
            {"n": "브레이크", "part": "전", "bars": 16, "pad": 1.0, "arp": 0.8, "drums": 0.0, "hat": 0.6, "bass": 0.6, "gear": 1.0, "mel": 0.5, "filt": 0.4},
            {"n": "다시", "part": "결", "bars": 16, "pad": 0.8, "arp": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "mel": 0.6, "filt": 0.65},
            {"n": "아웃트로", "part": "결", "bars": 16, "pad": 1.0, "arp": 0.6, "drums": 0.0, "hat": 0.5, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
        ], stage=2, energy=0.62, reverb=(2.4, 1.8, 0.7), wet=0.3, echo_beats=0.75, master_lp=12000)

CFG = {"prog": ["Bbm9", "Gbmaj7", "Ebm9", "F7sus"], "per": 2, "scale": [10, "minor"], "arp": {"kind": "saw", "rate": 4, "shape": [0, 0, 3, 1, 0, 2, 3, 1], "lo": 58, "hi": 77, "v": 0.2, "fc": 1800, "gate": 0.35, "sw_lo": 400, "sw_hi": 4500, "accent": 4}, "drums": "break", "bass": "long", "bass_gain": 0.85, "gear": ["relay", "beep"], "relay_pat": "-x---x-x-x---x--", "beep_m": 89, "beep_every": 4, "mel": {"inst": "organ", "lo": 65, "hi": 82, "v": 0.2}, "pad": {"v": 0.1}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
