#!/usr/bin/env python3
"""'다섯 시험관'(Five Test Tubes) — 복셀 연구소(Voxel Lab) 보통(1단계) 배경음악.

보통 · 5/4(3+2) 연구소 그루브 — 도약하는 블립 시퀀스, 1·4박 킥과 3·5박 림, 50Hz 험, 피펫 물방울, 일렉트릭 피아노 선율.
100 BPM 5/4 100마디 = 정확히 300초, Ab mixolydian(Ab9–Gbmaj7–Ebm7–Db6). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～10) → 전개(10～40) → 선율(40～72) → 정리(72～90) → 아웃트로(90～100)

  python music/compose_fivetubes.py --out <폴더>/bgm-fivetubes.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("fivetubes", "다섯 시험관",
        "보통 · 5/4(3+2) 연구소 그루브 — 도약하는 블립 시퀀스, 1·4박 킥과 3·5박 림, 50Hz 험, 피펫 물방울, 일렉트릭 피아노 선율",
        "Ab mixolydian", 100, [
            {"n": "인트로", "part": "기", "bars": 10, "pad": 1.0, "arp": 0.6, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 30, "pad": 0.9, "arp": 1.0, "drums": 1.0, "hat": 0.6, "bass": 1.0, "gear": 1.0, "mel": 0.0, "filt": 0.55},
            {"n": "선율", "part": "전", "bars": 32, "pad": 0.9, "arp": 0.9, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 0.9, "mel": 1.0, "filt": 0.75},
            {"n": "정리", "part": "결", "bars": 18, "pad": 1.0, "arp": 1.0, "drums": 0.6, "hat": 0.4, "bass": 0.8, "gear": 1.0, "mel": 0.3, "filt": 0.45},
            {"n": "아웃트로", "part": "결", "bars": 10, "pad": 1.0, "arp": 0.6, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
        ], stage=1, energy=0.4, beats=5, reverb=(2.8, 2.2, 0.8), wet=0.36, echo_beats=1.0, master_lp=11000)

CFG = {"prog": ["Ab9", "Gbmaj7", "Ebm7", "Db6"], "per": 2, "scale": [8, "mixo"], "arp": {"kind": "blip", "rate": 2, "shape": "leap", "lo": 68, "hi": 87, "v": 0.28, "echo": 0.5, "gate": 0.5, "accent": 5}, "drums": "five", "bass": "long", "gear": ["hum", "drip"], "drips": 3, "hum_gain": 0.04, "mel": {"inst": "epiano", "lo": 63, "hi": 80, "v": 0.26}, "pad": {"v": 0.11}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
