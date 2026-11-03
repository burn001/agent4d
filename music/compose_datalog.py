#!/usr/bin/env python3
"""'데이터 기록계'(Data Logger) — 복셀 연구소(Voxel Lab) 보통(1단계) 배경음악.

보통 · 셋잇단 칼림바 시퀀스와 느린 사각파 겹 아르페지오, 여린 킥·림, 계전기 딸깍, 드문 가이거 틱, 실로폰 선율.
96 BPM 4/4 120마디 = 정확히 300초, Eb major(Ebmaj9–Cm9–Abmaj7–Bb6). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～12) → 전개(12～48) → 선율(48～88) → 숨 고르기(88～108) → 아웃트로(108～120)

  python music/compose_datalog.py --out <폴더>/bgm-datalog.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("datalog", "데이터 기록계",
        "보통 · 셋잇단 칼림바 시퀀스와 느린 사각파 겹 아르페지오, 여린 킥·림, 계전기 딸깍, 드문 가이거 틱, 실로폰 선율",
        "Eb major", 96, [
            {"n": "인트로", "part": "기", "bars": 12, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
            {"n": "전개", "part": "승", "bars": 36, "pad": 0.9, "arp": 1.0, "arp2": 0.8, "drums": 1.0, "hat": 0.7, "bass": 1.0, "gear": 1.0, "mel": 0.0, "filt": 0.55},
            {"n": "선율", "part": "전", "bars": 40, "pad": 0.9, "arp": 1.0, "arp2": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 0.9, "mel": 1.0, "filt": 0.75},
            {"n": "숨 고르기", "part": "결", "bars": 20, "pad": 1.0, "arp": 0.8, "arp2": 0.5, "drums": 0.5, "hat": 0.4, "bass": 0.8, "gear": 1.0, "mel": 0.3, "filt": 0.45},
            {"n": "아웃트로", "part": "결", "bars": 12, "pad": 1.0, "arp": 0.7, "arp2": 0.0, "drums": 0.0, "hat": 0.0, "bass": 0.5, "gear": 0.8, "mel": 0.0, "filt": 0.3},
        ], stage=1, energy=0.42, reverb=(2.6, 2.0, 0.8), wet=0.34, echo_beats=0.6666666666666666, master_lp=11500)

CFG = {"prog": ["Ebmaj9", "Cm9", "Abmaj7", "Bb6"], "per": 2, "scale": [3, "major"], "arp": {"kind": "kalimba", "rate": 3, "shape": "up", "lo": 63, "hi": 82, "v": 0.3, "echo": 0.4, "gate": 0.9, "accent": 3, "gain": 0.75}, "arp2": {"kind": "square", "rate": 1, "shape": "leap", "lo": 55, "hi": 70, "v": 0.12, "fc": 1600, "gate": 0.8, "echo": 0.3, "pan": -0.2, "sw_lo": 500, "sw_hi": 3500}, "drums": "soft", "bass": "long", "gear": ["relay", "geiger"], "relay_pat": "x---x-x---x---x-", "geiger_rate": 1, "mel": {"inst": "xylo", "lo": 70, "hi": 87, "v": 0.34}, "pad": {"v": 0.1}}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
