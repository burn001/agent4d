#!/usr/bin/env python3
"""'청정실'(Clean Room) — 복셀 연구소(Voxel Lab) 한가(0단계) 배경음악.

한가 · 연구소 청정실 앰비언트 — 느린 블립 아르페지오, 50Hz 전원 험, 유리 같은 패드, 먼 피펫 물방울, 비트 없음.
64 BPM 4/4 80마디 = 정확히 300초, A minor(Am9–Fmaj7–Cmaj7–G6). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～16) → 전개(16～40) → 화음(40～64) → 아웃트로(64～80)

  python music/compose_cleanroom.py --out <폴더>/bgm-cleanroom.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("cleanroom", "청정실",
        "한가 · 연구소 청정실 앰비언트 — 느린 블립 아르페지오, 50Hz 전원 험, 유리 같은 패드, 먼 피펫 물방울, 비트 없음",
        "A minor", 64, [
            {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.2},
            {"n": "전개", "part": "승", "bars": 24, "pad": 0.9, "arp": 0.9, "gear": 1.0, "mel": 0.6, "filt": 0.45},
            {"n": "화음", "part": "전", "bars": 24, "pad": 1.0, "arp": 1.0, "gear": 0.9, "mel": 1.0, "filt": 0.65},
            {"n": "아웃트로", "part": "결", "bars": 16, "pad": 1.0, "arp": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.2},
        ], stage=0, energy=0.12, reverb=(4.5, 3.5, 1.4), wet=0.5, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["Am9", "Fmaj7", "Cmaj7", "G6"], "per": 4, "scale": [9, "minor"], "arp": {"kind": "blip", "rate": 2, "shape": "updown", "lo": 69, "hi": 88, "v": 0.32, "echo": 0.6, "gate": 0.5}, "drums": "none", "bass": "long", "gear": ["hum", "drip"], "drips": 1, "mel": {"inst": "musicbox", "lo": 72, "hi": 88, "v": 0.22}, "pad": {"v": 0.13, "lo": 55, "hi": 72}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
