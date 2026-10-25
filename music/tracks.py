#!/usr/bin/env python3
"""배경음악 곡 목록 관리.

web/assets/bgm-tracks.json 매니페스트가 곡 목록의 원본이다(순서·짧은 이름·자동 선곡 단계 stage·energy·출처).
아래 BUILTIN 은 처음 네 곡의 기본값일 뿐이고, 곡마다의 제목·분위기·BPM·조·길이는
web/assets/<곡>.json(합성 스크립트가 쓴 메타)에서 다시 읽는다.

  # 매니페스트만 다시 쓰기(메타 json 값 다시 반영)
  python music/tracks.py manifest

  # 합성 결과 폴더(compose_<id>.py·bgm-<id>.mp3·bgm-<id>.json 이 있는 곳)에서 레포로 복사 + 매니페스트 갱신
  python music/tracks.py copy jazz --from <폴더>
  # 새 곡: 단계(0 한가 · 1 보통 · 2 활발 · 3 매우 활발, 여러 단계면 1,2)·energy(0～1)·짧은 이름을 함께
  python music/tracks.py copy chillhop --from <폴더> --stage 1 --energy 0.4 --label 칠홉 --source "자체 작곡" \
      --label-en Chillhop --title-en "Slow Pour" --mood-en "chillhop / lo-fi jazz"   # 영어 화면용(없으면 아래 EN 표)

copy 는 compose_<id>.py → music/, bgm-<id>.mp3·bgm-<id>.json → web/assets/ 로 덮어쓴다(report.md·spectrogram.png 는 복사하지 않음).
이미 있는 곡을 다시 copy 하면 옵션으로 준 값만 바뀐다. 매니페스트에서 곡을 빼려면 `remove <id>`(파일은 지우지 않음).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "web", "assets")
MANIFEST = os.path.join(ASSETS, "bgm-tracks.json")

# 처음 네 곡 기본값(매니페스트에 없을 때만 쓰임). stage = 자동 선곡 단계(정수 또는 목록), energy = 0～1(같은 단계 안 순서·단계 없을 때 추정)
BUILTIN = [
    {"id": "ambient", "label": "앰비언트", "file": "bgm.mp3", "meta": "bgm.json", "script": "compose.py", "stage": 0, "energy": 0.1,
     "title": "앰비언트", "mood": "앰비언트 · 패드·벨·아르페지오, 기승전결", "source": "자체 작곡(music/compose.py)"},
    {"id": "lofi", "label": "로파이", "file": "bgm-lofi.mp3", "meta": "bgm-lofi.json", "script": "compose_lofi.py", "stage": 1, "energy": 0.35,
     "source": "작성자의 이전 프로젝트 곡(deep) 편곡"},
    {"id": "jazz", "label": "재즈", "file": "bgm-jazz.mp3", "meta": "bgm-jazz.json", "script": "compose_jazz.py", "stage": 1, "energy": 0.45,
     "source": "작성자의 이전 프로젝트 곡(cafe) 편곡"},
    {"id": "city", "label": "작은 도시", "file": "bgm-city.mp3", "meta": "bgm-city.json", "script": "compose_city.py", "stage": [2, 3], "energy": 0.7,
     "source": "작성자의 이전 프로젝트 곡(city) 편곡"},
]
DEFAULT = "lofi"
FIELDS = ["id", "label", "title", "mood", "label_en", "title_en", "mood_en", "file", "meta", "bpm", "key", "key_en", "duration", "bytes",
          "stage", "energy", "source"]

# 영어 화면용 곡 이름·제목·설명. 매니페스트 항목에 label_en·title_en·mood_en(key_en) 이 이미 있으면 그쪽 우선,
# 없으면 이 표. 새 곡은 copy --label-en·--title-en·--mood-en 으로 주거나 여기에 더한다. 클라이언트는 영어 화면에서 이 필드를, 없으면 기존 이름을 쓴다
EN = {
    "ambient": {"label_en": "Ambient", "title_en": "Ambient",
                "mood_en": "Ambient · pads, bells and arpeggios in four movements"},
    "lofi": {"label_en": "Lo-fi", "title_en": "Deep Work", "mood_en": "Lo-fi · downtempo coding ambient"},
    "jazz": {"label_en": "Jazz", "title_en": "Corner Café (5-min arrangement)",
             "mood_en": "Jazzy work music — electric piano, brushes, walking bass, triplet swing, calm"},
    "city": {"label_en": "Small Town", "title_en": "Small Town",
             "mood_en": "Bright, gentle focus — marimba ostinato, plucks, strings, light shaker, rim and soft kick"},
    "chillhop": {"label_en": "Chillhop", "title_en": "Slow Pour",
                 "mood_en": "chillhop / lo-fi jazz, boom-bap swing, warm, unobtrusive"},
    "dawn": {"label_en": "Dawn Piano", "title_en": "Dawn Piano",
             "mood_en": "Idle · felt piano ambient for quiet early-morning thinking"},
    "orbit": {"label_en": "Orbit Drift", "title_en": "Orbit Drift",
              "mood_en": "Space ambient · weightless drones, pads and distant bells, no beat"},
    "drive": {"label_en": "Night Drive", "title_en": "Night Drive",
              "mood_en": "Soft synthwave drive — octave eighth-note bass, chorused poly-synth pads, arpeggios, soft square lead, round gated snare"},
    "deephouse": {"label_en": "Flowing Lines", "title_en": "Flowing Lines",
                  "mood_en": "A steady, lively work groove — soft deep house, round kick, dark off-beat hats, swung shaker, minor 9/11 chord stabs, warm sub bass"},
    "funk": {"label_en": "Studio Groove", "title_en": "Studio Groove",
             "mood_en": "Fusion funk — 16th-note groove drums, finger-funk bass, clavinet comping, Rhodes EP, small synth brass; happily busy work",
             "key_en": "E minor (E dorian, F# minor late in the climax)"},
    "liquid": {"label_en": "Fast Current", "title_en": "Fast Current",
               "mood_en": "Liquid drum & bass — round kick, soft breakbeats, rolling sub bass, dreamy pads and EP (minor 9), flute and bell motifs"},
    "uplift": {"label_en": "Updraft", "title_en": "Updraft",
               "mood_en": "Momentum for very busy, high-volume work — 128 BPM melodic progressive, rolling 16th pulse bass, layered pluck arpeggios, "
                          "wide supersaw pads, soft kick and clap, a slowly opening filter, uplifting major key with tamed highs"},
}

# 곡 구간 이름(메타 json sections[].name, 한국어) → 영어. 매니페스트 맨 위 sections_en 으로 내보내 클라이언트가 영어 화면에서 바꿔 보인다
SECTIONS_EN = {
    "A": "A", "A · 다시": "A · again", "A · 주제": "A · theme", "B": "B", "B · 끝": "B · end",
    "기": "Opening", "승": "Development", "전": "Turn", "결": "Resolution",
    "고조": "Rise", "귀결": "Resolution", "그루브": "Groove", "드론": "Drone", "드론 귀환": "Drone returns", "드롭": "Drop",
    "먼 벨": "Distant bells", "모티프": "Motif", "브레이크": "Break", "브레이크다운": "Breakdown", "빌드": "Build",
    "빌드업": "Build-up", "빌드업 2": "Build-up 2", "새벽": "Dawn", "아웃트로": "Outro", "인트로": "Intro", "인트로 2": "Intro 2",
    "잦아듦": "Fading", "전개": "Unfolding", "정리": "Wind-down", "정리 2": "Wind-down 2", "클라이맥스": "Climax",
    "패드 전개": "Pad bloom", "하모닉스 고조": "Harmonics rise", "화성 전환": "Harmonic shift", "화음": "Chords",
    "회귀": "Return", "흐름": "Drift",
}


def names(tid: str) -> dict:
    """새 곡 파일 이름 규칙: compose_<id>.py · bgm-<id>.mp3 · bgm-<id>.json"""
    return {"file": f"bgm-{tid}.mp3", "meta": f"bgm-{tid}.json", "script": f"compose_{tid}.py"}


def read_manifest() -> dict:
    try:
        with open(MANIFEST, encoding="utf-8") as fh:
            m = json.load(fh)
        if isinstance(m, dict) and isinstance(m.get("tracks"), list):
            return m
    except (OSError, ValueError):
        pass
    return {"version": 2, "default": DEFAULT, "tracks": []}


def entries() -> list[dict]:
    """매니페스트 순서 + 빠진 BUILTIN 은 뒤에"""
    m = read_manifest()
    out = [dict(t) for t in m["tracks"] if isinstance(t, dict) and t.get("id")]
    have = {t["id"] for t in out}
    for b in BUILTIN:
        if b["id"] not in have:
            out.append({k: v for k, v in b.items() if k != "script"})
    return out


def norm_stage(v):
    if isinstance(v, list):
        s = sorted({int(x) for x in v if 0 <= int(x) <= 3})
        return s[0] if len(s) == 1 else (s or None)
    if v is None:
        return None
    return max(0, min(3, int(v)))


def build_manifest(ents: list[dict] | None = None) -> dict:
    out = []
    for t in ents if ents is not None else entries():
        mp3 = os.path.join(ASSETS, t["file"])
        if not os.path.exists(mp3):
            print(f"  건너뜀: {t['id']} — {t['file']} 없음", file=sys.stderr)
            continue
        meta = {}
        try:
            with open(os.path.join(ASSETS, t["meta"]), encoding="utf-8") as fh:
                meta = json.load(fh)
        except (OSError, ValueError, KeyError):
            pass
        b = next((x for x in BUILTIN if x["id"] == t["id"]), {})
        e = {
            "id": t["id"],
            "label": t.get("label") or b.get("label") or t["id"],
            "title": meta.get("title") or t.get("title") or b.get("title") or t.get("label") or t["id"],
            "mood": meta.get("mood") or t.get("mood") or b.get("mood") or "",
            "file": t["file"],
            "meta": t.get("meta"),
            "bpm": meta.get("bpm", t.get("bpm")),
            "key": meta.get("key", t.get("key")),
            "duration": meta.get("duration", t.get("duration")),
            "bytes": os.path.getsize(mp3),
            "stage": norm_stage(t.get("stage", b.get("stage"))),
            "energy": t.get("energy", b.get("energy")),
            "source": t.get("source") or b.get("source") or "",
        }
        en = EN.get(t["id"], {})
        for k in ("label_en", "title_en", "mood_en", "key_en"):
            e[k] = t.get(k) or en.get(k)
        if not e["title_en"] and e["label_en"] and e["title"] == e["label"]:
            e["title_en"] = e["label_en"]
        out.append({k: e[k] for k in FIELDS if e[k] is not None or k not in ("label_en", "title_en", "mood_en", "key_en")})
        for sec in meta.get("sections") or []:
            n = sec.get("name") if isinstance(sec, dict) else None
            if n and n not in SECTIONS_EN and not n.isascii():
                print(f"  구간 이름 영어 없음: {t['id']} — {n} (SECTIONS_EN 에 더하십시오)", file=sys.stderr)
    return {"version": 2, "default": read_manifest().get("default") or DEFAULT, "sections_en": SECTIONS_EN, "tracks": out}


def write_manifest(ents: list[dict] | None = None) -> dict:
    m = build_manifest(ents)
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(m, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"매니페스트: {os.path.relpath(MANIFEST, ROOT).replace(os.sep, "/")} — "
          + ", ".join(f"{t['id']}(단계 {t['stage']})" for t in m["tracks"]))
    return m


def parse_stage(s: str | None):
    if s is None:
        return None
    parts = [int(x) for x in str(s).replace(" ", "").split(",") if x != ""]
    if not parts or any(p < 0 or p > 3 for p in parts):
        raise SystemExit(f"--stage 는 0～3(여러 단계면 1,2): {s}")
    return parts[0] if len(parts) == 1 else parts


def copy_track(tid: str, src: str, stage=None, energy=None, label=None, title=None, source=None, en=None) -> list[dict]:
    ents = entries()
    t = next((x for x in ents if x["id"] == tid), None)
    b = next((x for x in BUILTIN if x["id"] == tid), None)
    fresh = t is None
    if fresh:
        if stage is None and energy is None:
            raise SystemExit(f"새 곡 {tid}: --stage(0～3) 또는 --energy(0～1) 를 주십시오")
        t = {"id": tid, **{k: v for k, v in names(tid).items() if k != "script"}, "label": label or tid}
        ents.append(t)
    script = (b or {}).get("script") or names(tid)["script"]
    pairs = [(script, HERE, False), (t["file"], ASSETS, True), (t["meta"], ASSETS, True)]
    for name, _dst, need in pairs:
        p = os.path.join(src, name)
        if need and not os.path.exists(p):
            raise SystemExit(f"없음: {p}")
    for name, dst, _need in pairs:
        p = os.path.join(src, name)
        if not os.path.exists(p):
            print(f"  (없음, 건너뜀) {name}")
            continue
        shutil.copy2(p, os.path.join(dst, name))
        print(f"  복사: {name} → {os.path.relpath(dst, ROOT).replace(os.sep, "/")}/")
    if stage is not None:
        t["stage"] = stage
    if energy is not None:
        if not 0 <= energy <= 1:
            raise SystemExit("--energy 는 0～1")
        t["energy"] = energy
        if t.get("stage") is None:
            t["stage"] = max(0, min(3, round(energy * 3)))
    if label:
        t["label"] = label
    if title:
        t["title"] = title
    for k, v in (en or {}).items():
        if v:
            t[k] = v
    if source:
        t["source"] = source
    elif fresh and not t.get("source"):
        t["source"] = "자체 작곡"
    return ents


def main(argv=None) -> int:
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="배경음악 곡 목록 관리")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("manifest", help="web/assets/bgm-tracks.json 다시 쓰기")
    c = sub.add_parser("copy", help="합성 결과 폴더에서 곡 하나 복사 + 매니페스트 갱신")
    c.add_argument("id")
    c.add_argument("--from", dest="src", required=True, help="compose_<id>.py·bgm-<id>.mp3·bgm-<id>.json 이 있는 폴더")
    c.add_argument("--stage", help="자동 선곡 단계 0 한가 · 1 보통 · 2 활발 · 3 매우 활발 (여러 단계면 1,2)")
    c.add_argument("--energy", type=float, help="0～1, 같은 단계 안 순서(단계를 안 주면 round(energy×3) 단계)")
    c.add_argument("--label", help="선택기에 보일 짧은 이름")
    c.add_argument("--title", help="제목(메타 json 의 title 이 있으면 그쪽 우선)")
    c.add_argument("--source", help="출처 문구")
    c.add_argument("--label-en", help="영어 화면용 짧은 이름")
    c.add_argument("--title-en", help="영어 화면용 제목")
    c.add_argument("--mood-en", help="영어 화면용 곡 설명")
    r = sub.add_parser("remove", help="매니페스트에서 곡 빼기(파일은 그대로)")
    r.add_argument("id")
    a = ap.parse_args(argv)
    ents = None
    if a.cmd == "copy":
        ents = copy_track(a.id, a.src, parse_stage(a.stage), a.energy, a.label, a.title, a.source,
                          {"label_en": a.label_en, "title_en": a.title_en, "mood_en": a.mood_en})
    elif a.cmd == "remove":
        ents = [t for t in entries() if t["id"] != a.id]
    write_manifest(ents)
    return 0


if __name__ == "__main__":
    sys.exit(main())
