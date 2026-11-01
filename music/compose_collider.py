#!/usr/bin/env python3
"""'입자 가속기'(Particle Collider) — 복셀 연구소(Voxel Lab) 매우 활발(3단계) 배경음악.

매우 활발 · 고리 위를 달리는 입자 — 148 BPM 드라이브 비트, 16분 사각파 시퀀서, 블립 폭주, 계전기 연타, 옥타브 베이스.
148 BPM 4/4 185마디 = 정확히 300초, A harmonic minor(Am9–F–Dm9–E7b9). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～16) → 빌드업(16～52) → 클라이맥스(52～104) → 브레이크다운(104～120) → 드롭(120～169) → 아웃트로(169～185)

  python music/compose_collider.py --out <폴더>/bgm-collider.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("collider", "입자 가속기",
        "매우 활발 · 고리 위를 달리는 입자 — 148 BPM 드라이브 비트, 16분 사각파 시퀀서, 블립 폭주, 계전기 연타, 옥타브 베이스",
        "A harmonic minor", 148, [
            {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.0, "gear": 0.8, "filt": 0.35},
            {"n": "빌드업", "part": "승", "bars": 36, "pad": 0.7, "arp": 1.0, "arp2": 0.6, "drums": 1.0, "hat": 0.8, "bass": 1.0, "gear": 1.0, "filt": 0.6},
            {"n": "클라이맥스", "part": "전", "bars": 52, "pad": 0.6, "arp": 1.0, "arp2": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "filt": 0.95},
            {"n": "브레이크다운", "part": "전", "bars": 16, "pad": 1.0, "arp": 0.8, "arp2": 1.0, "drums": 0.0, "hat": 0.4, "bass": 0.0, "gear": 1.0, "filt": 0.45},
            {"n": "드롭", "part": "전", "bars": 49, "pad": 0.6, "arp": 1.0, "arp2": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "filt": 0.9},
            {"n": "아웃트로", "part": "결", "bars": 16, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.0, "gear": 0.8, "filt": 0.35},
        ], stage=3, energy=0.93, reverb=(2.2, 1.7, 0.6), wet=0.26, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["Am9", "F", "Dm9", "E7b9"], "per": 2, "scale": [9, "harmonic"], "arp": {"kind": "square", "rate": 4, "shape": "up", "lo": 64, "hi": 83, "v": 0.18, "fc": 3000, "gate": 0.42, "sw_lo": 600, "sw_hi": 7000, "accent": 4}, "arp2": {"kind": "blip", "rate": 4, "shape": "leap", "lo": 76, "hi": 95, "v": 0.22, "gate": 0.3, "echo": 0.5, "pan": -0.2, "accent": 3}, "drums": "drive", "bass": "octave", "gear": ["relay", "beep"], "relay_pat": "x-xx-x-xx-x-x-xx", "beep_m": 88, "beep_every": 4}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
