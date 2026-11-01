#!/usr/bin/env python3
"""'원심분리기'(Centrifuge) — 복셀 연구소(Voxel Lab) 활발(2단계) 배경음악.

활발 · 돌아가는 원심분리기 — 4박 킥, 16분 톱니 시퀀서, 회전하는 잡음 휘이잉, 계전기 리듬, 8분 펄스 베이스.
120 BPM 4/4 150마디 = 정확히 300초, C# minor(C#m9–Amaj7–E6–B6). 시드 2026 결정적 합성, 공용 엔진 bgmkit + 연구소 편곡기 labkit.
  인트로(0～16) → 빌드(16～48) → 고조(48～88) → 브레이크(88～104) → 드롭(104～134) → 아웃트로(134～150)

  python music/compose_centrifuge.py --out <폴더>/bgm-centrifuge.mp3
"""
from __future__ import annotations

import sys

import bgmkit as E
import labkit

E.setup("centrifuge", "원심분리기",
        "활발 · 돌아가는 원심분리기 — 4박 킥, 16분 톱니 시퀀서, 회전하는 잡음 휘이잉, 계전기 리듬, 8분 펄스 베이스",
        "C# minor", 120, [
            {"n": "인트로", "part": "기", "bars": 16, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.0, "gear": 0.8, "filt": 0.3},
            {"n": "빌드", "part": "승", "bars": 32, "pad": 0.8, "arp": 1.0, "drums": 1.0, "hat": 0.7, "bass": 1.0, "gear": 1.0, "filt": 0.55},
            {"n": "고조", "part": "전", "bars": 40, "pad": 0.7, "arp": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "filt": 0.9},
            {"n": "브레이크", "part": "전", "bars": 16, "pad": 1.0, "arp": 0.8, "drums": 0.0, "hat": 0.4, "bass": 0.0, "gear": 1.0, "filt": 0.4},
            {"n": "드롭", "part": "전", "bars": 30, "pad": 0.7, "arp": 1.0, "drums": 1.0, "hat": 1.0, "bass": 1.0, "gear": 1.0, "filt": 0.8},
            {"n": "아웃트로", "part": "결", "bars": 16, "pad": 1.0, "arp": 0.7, "drums": 0.0, "hat": 0.0, "bass": 0.0, "gear": 0.8, "filt": 0.3},
        ], stage=2, energy=0.66, reverb=(2.6, 2.0, 0.8), wet=0.3, echo_beats=0.75, echo_fb=0.45, master_lp=11500)

CFG = {"prog": ["C#m9", "Amaj7", "E6", "B6"], "per": 2, "scale": [1, "minor"], "arp": {"kind": "saw", "rate": 4, "shape": "updown", "lo": 61, "hi": 80, "v": 0.22, "fc": 3000, "gate": 0.45, "sw_lo": 500, "sw_hi": 6500, "accent": 3}, "drums": "four", "bass": "pulse8", "gear": ["whir", "relay"], "whir_hz": 950, "whir_rate": 4, "whir_gain": 0.06, "relay_pat": "--x---x---x--x-x"}

if __name__ == "__main__":
    sys.exit(labkit.run(CFG))
