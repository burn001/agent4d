#!/usr/bin/env python3
"""복셀 연구소(Voxel Lab, 표현 id `lab`) 배경음악 8곡 공용 편곡기 — bgmkit 위에 연구소 음색만 더한다(2026-11-01).

다른 테마와 구별되는 연구소 소리:
- 시퀀서 아르페지오(필터 열리는 톱니·사각·블립, 3:4 폴리리듬 겹 아르페지오)
- 실험 장비 리듬감: 계전기 딸깍(16분 기계 패턴), 피펫 물방울(떨어지는 사인), 가이거 계수기 틱, 원심분리기 회전음, 50Hz 전원 험
- 차분한 전자음 패드·FM 벨 모티프

곡 스크립트(compose_<id>.py)는 bgmkit.setup(...) 으로 BPM·섹션을 정한 뒤 `run(cfg)` 를 부른다.
섹션 레벨 키: pad · arp · arp2 · drums · hat · bass · gear · mel · filt(아르페지오 필터 곡선).
첫 구간과 마지막 구간 레벨을 같게 두어 루프 이음매를 맞춘다. 장비 질감(험·회전음)은 주파수·LFO 를 300초 정수 주기로 맞춘다.
"""
from __future__ import annotations

import sys

import numpy as np

import bgmkit as E
from bgmkit import (Layer, tb, lv, prog_at, pads, voicing, scale_of, chord_pcs, kick, snare, clap, hat, shaker,
                    sub_note, bass_note, saw_note, tone_hit, noise_hit, riser, inst, melody, mtof, loopf)

F32 = np.float32


def _arp_notes(ch, lo, hi):
    pcs = chord_pcs(ch)
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def _arp_seq(notes, shape, steps, bar):
    """한 마디 아르페지오 음 목록(길이 steps)."""
    n = len(notes)
    if not n:
        return []
    if shape == "up":
        idx = [i % n for i in range(steps)]
    elif shape == "updown":
        cyc = list(range(n)) + list(range(n - 2, 0, -1)) or [0]
        idx = [cyc[i % len(cyc)] for i in range(steps)]
    elif shape == "down":
        idx = [(n - 1 - i) % n for i in range(steps)]
    elif shape == "leap":  # 근음-위-가운데-위 (시퀀서 같은 도약)
        pat = [0, n - 1, n // 2, n - 1, 1 % n, n - 2 if n > 2 else 0, n // 2, n - 1]
        idx = [pat[i % len(pat)] for i in range(steps)]
    else:  # 정수 목록 = 화음 음 색인 패턴
        idx = [shape[i % len(shape)] % n for i in range(steps)]
    rot = (bar % 2) if shape in ("up", "down") else 0
    return [notes[(i + rot) % n] for i in idx]


def _arp_sig(kind, m, dur, v, fc):
    if kind == "saw":
        return saw_note(m, round(dur, 3), fc, fc * 0.35, 0.09, 0.004, 0.05) * F32(v)
    if kind == "square":
        return saw_note(m, round(dur, 3), fc, fc * 0.4, 0.12, 0.004, 0.05, True) * F32(v)
    return inst(kind, m, dur, v)


def _full(sig_fn):
    """원형 전체 길이(N) 모노 신호 — 시간축 t 를 받아 만든다."""
    t = np.arange(E.N, dtype=np.float64) / E.SR
    return sig_fn(t).astype(F32)


def _hum(base=50.0):
    f = loopf(base)
    am = loopf(1 / 9.0)

    def fn(t):
        y = 0.6 * np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t + 0.4) + 0.12 * np.sin(2 * np.pi * 3 * f * t + 1.1)
        return y * (0.75 + 0.25 * np.sin(2 * np.pi * am * t))
    return _full(fn)


def _whir(fc=900.0, per_beat=4):
    """원심분리기 회전음: 대역 잡음 + 박에 맞춘 회전 진폭 변조(주기가 박의 약수 → 루프 정합)."""
    r = np.random.default_rng(4242)
    x = r.standard_normal(E.N).astype(F32)
    f = E.freqs()
    y = E.fd_filter(x[None, :], E.bpq(f, fc, 3.0))[0]
    y = y / (np.abs(y).max() + 1e-9)
    t = np.arange(E.N, dtype=np.float64) / E.SR
    am = 0.55 + 0.45 * np.sin(2 * np.pi * per_beat * t / E.BEAT) ** 2
    return (y * am).astype(F32)


def relay():
    return tone_hit(3100.0, 0.009, 0.0, 0.02, ((1.0, 1.0), (1.73, 0.5)), 0.7, 6500, 3)


def drip(m):
    return tone_hit(mtof(m), 0.07, 0.7, 0.012, ((1.0, 1.0), (2.0, 0.12)))


def geiger(var):
    return noise_hit(var % 6, 0.0025, 4200, 0.9, 11000, length=0.02)


def beep(m):
    return tone_hit(mtof(m), 0.09, 0.0, 0.02, ((1.0, 1.0), (3.0, 0.08)))


def build_track(cfg):
    """cfg 로 층을 채운다. 키:
    prog(화음 목록)·per(화음당 마디)·scale((pc, mode))
    arp {kind, rate(박당 음 수), shape, lo, hi, v, fc, gate(음 길이 비율), accent(강세 주기)}
    arp2 (같은 형식, 선택 — 폴리리듬 겹)·drums(none·soft·half·four·drive)·bass(long·pulse8·octave·none)
    gear(hum·relay·drip·geiger·whir·beep 집합)·relay_pat(16칸 문자열)·mel {inst, lo, hi, v}·pad {lo, hi, v}
    """
    CH = prog_at(cfg["prog"], per=cfg.get("per", 2))
    SC = scale_of(*cfg["scale"])
    r = np.random.default_rng(cfg.get("seed2", 700))
    layers = []

    pd = cfg.get("pad", {})
    pad = Layer("pad", dry=0.45, rev=0.6, hp=140, lp=pd.get("lp", 4200), width=1.5, tau=5.0)
    pads(pad, CH, pd.get("lo", 57), pd.get("hi", 74), every=cfg.get("per", 2), v=pd.get("v", 0.12), a=pd.get("a", 2.0),
         rel=3.0, cents=pd.get("cents", 9))
    layers.append(pad)

    def arp_layer(name, a):
        L = Layer(name, dry=0.55, rev=0.35, echo=a.get("echo", 0.45), hp=180, sweep=(a.get("sw_lo", 700), a.get("sw_hi", 7000)),
                  tau=2.0, duck=a.get("duck", 0.2), width=1.2, gain=a.get("gain", 1.7))
        step = 1.0 / a.get("rate", 2)
        acc = a.get("accent", 4)
        pan = a.get("pan", 0.0)
        total = int(E.BARS * E.BEATS / step + 1e-6)  # 전역 걸음 — rate 4/3 처럼 마디에 안 맞는 겹 아르페지오도 끊기지 않고 흐른다
        cache = {}
        for k in range(total):
            beat = k * step
            bar = int(beat // E.BEATS + 1e-9)
            if bar not in cache:
                cache[bar] = _arp_seq(_arp_notes(CH(bar), a.get("lo", 60), a.get("hi", 79)), a.get("shape", "up"), 64, bar)
            seq = cache[bar]
            if not seq:
                continue
            m = seq[k % len(seq)]
            v = a.get("v", 0.3) * (1.0 if k % acc == 0 else 0.68)
            sp = pan + (0.25 if k % 2 else -0.25) * a.get("spread", 1.0)
            L.add(tb(0, beat), _arp_sig(a.get("kind", "saw"), m, step * E.BEAT * a.get("gate", 0.6), v, a.get("fc", 2600)), 1.0, sp)
        return L

    layers.append(arp_layer("arp", cfg["arp"]))
    if cfg.get("arp2"):
        layers.append(arp_layer("arp2", cfg["arp2"]))

    style = cfg.get("drums", "none")
    if style != "none":
        dr = Layer("drums", dry=0.9, rev=0.2, lp=9000, tau=1.0)
        hh = Layer("hat", dry=0.6, rev=0.15, hp=5500, tau=1.5, gain=2.5)
        fx = Layer("fx", dry=0.5, rev=0.5, hp=400, tau=1.0)
        soft = lambda i: kick(48.0, 60.0, 0.03, 0.26, 0.1, 1.2)
        punch = lambda i: kick(46.0, 90.0, 0.035, 0.3, 0.3, 1.6)
        kv = cfg.get("kick", 0.55)  # 4박 킥이 아르페지오(연구소 얼굴)를 덮지 않게
        rim = lambda i: tone_hit(1700.0, 0.03, 0.4, 0.004, ((1.0, 1.0), (2.4, 0.4)), 0.4, 3000, i % 3)
        for bar in range(E.BARS):
            if lv("drums", bar) > 0:
                if style == "soft":
                    E.pattern(dr, bar, "X-------x-------" if bar % 2 else "X-------x-----o-", soft, 0.6, kick=True)
                    E.pattern(dr, bar, "----x-------x---", rim, 0.22, 0.25)
                elif style == "half":
                    E.pattern(dr, bar, "X-----x---------" if bar % 2 else "X---------x-----", soft, 0.7, kick=True)
                    E.pattern(dr, bar, "--------X-------" if bar % 4 != 3 else "--------X-----o-", lambda i: snare(bar % 3, 210, 0.14, 0.5, 2400, 0.5), 0.45)
                elif style == "four":
                    E.pattern(dr, bar, "X---X---X---X---", punch, 0.7 * kv, kick=True)
                    E.pattern(dr, bar, "----X-------X---", lambda i: clap(bar % 3), 0.32)
                else:  # drive
                    E.pattern(dr, bar, "X---X---X---X-x-" if bar % 4 == 3 else "X---X---X---X---", punch, 0.75 * kv, kick=True)
                    E.pattern(dr, bar, "----X-------X---" if bar % 8 != 7 else "----X-------X.xX", lambda i: snare(i % 3, 200, 0.12, 0.45, 3000, 0.6), 0.42)
            if lv("hat", bar) > 0:
                if style in ("soft", "half"):
                    E.pattern(hh, bar, "x-o-x-o-x-o-x-oo", lambda i: shaker(i % 4), 0.12, -0.25, swing=0.08)
                elif style == "four":
                    E.pattern(hh, bar, "--x---x---x---x-", lambda i: hat(i % 4, True), 0.12, 0.2)
                    E.pattern(hh, bar, "o.o.o.o.o.o.o.o.", lambda i: hat(i % 4), 0.1, -0.2)
                else:
                    E.pattern(hh, bar, "xoxoxoxoxoxoxoxo", lambda i: hat(i % 4), 0.13, -0.15)
                    E.pattern(hh, bar, "--x---x---x---x-", lambda i: hat(i % 4, True), 0.1, 0.25)
            # 빌드업: 다음 구간에서 드럼이 들어오면 2마디 잡음 상승
            nb = bar + 2
            if style in ("four", "drive") and any(s["start"] == nb % E.BARS for s in E.SECS) and lv("drums", nb) > lv("drums", bar):
                fx.add(tb(bar), riser(2 * E.BAR, bar % 3, 600.0, 6500.0), 0.6)
        layers += [dr, hh, fx]

    bs = cfg.get("bass", "long")
    if bs != "none":
        sub = Layer("bass", dry=1.0, lp=cfg.get("bass_lp", 260), tau=2.0, duck=0.35, gain=cfg.get("bass_gain", 0.75))
        for bar in range(E.BARS):
            b = bass_note(CH(bar), cfg.get("bass_lo", 31))
            if bs == "long":
                sub.add(tb(bar), sub_note(b, E.BAR * 0.95, 0.02, 0.3, 0.1), 0.36)
            elif bs == "pulse8":
                for k in range(8):
                    sub.add(tb(bar, k * 0.5), sub_note(b, E.BEAT * 0.38, 0.004, 0.05, 0.25, 1.6), 0.3 if k % 2 else 0.36)
            else:  # octave
                for k in range(8):
                    sub.add(tb(bar, k * 0.5), sub_note(b + (12 if k % 2 else 0), E.BEAT * 0.4, 0.004, 0.05, 0.2, 1.5), 0.3)
        layers.append(sub)

    gear = set(cfg.get("gear", ()))
    if gear:
        g = Layer("gear", dry=0.6, rev=0.35, echo=0.25, hp=300, lp=11000, tau=2.5, gain=cfg.get("gear_gain", 1.5))
        hi = [m for m in range(cfg.get("drip_lo", 81), cfg.get("drip_hi", 96)) if m % 12 in SC]
        pat = cfg.get("relay_pat", "x--x--x---x-x---")
        for bar in range(E.BARS):
            if "relay" in gear:
                E.pattern(g, bar, pat, lambda i: relay(), 0.16, 0.45, jit=0.001)
            if "drip" in gear and bar % 2 == 0:
                for k in sorted(r.choice(16, size=int(cfg.get("drips", 2)), replace=False)):
                    m = hi[int(r.integers(0, len(hi)))]
                    g.add(tb(bar, k / 4), drip(m), 0.22, float(r.uniform(-0.6, 0.6)))
            if "geiger" in gear:
                for _ in range(int(r.poisson(cfg.get("geiger_rate", 3)))):
                    g.add(tb(bar, float(r.uniform(0, E.BEATS))), geiger(int(r.integers(0, 6))), 0.1, float(r.uniform(-0.8, 0.8)))
            if "beep" in gear and bar % cfg.get("beep_every", 2) == 0:
                g.add(tb(bar), beep(cfg.get("beep_m", 93)), 0.12, -0.5)
        layers.append(g)
        if "hum" in gear:
            hm = Layer("gear", dry=0.5, rev=0.1, lp=600, tau=4.0, gain=cfg.get("hum_gain", 0.05))
            hm.add(0.0, _hum(cfg.get("hum_hz", 50.0)), 1.0)
            layers.append(hm)
        if "whir" in gear:
            wh = Layer("gear", dry=0.5, rev=0.3, tau=3.0, gain=cfg.get("whir_gain", 0.05) * 2.5, width=1.4)
            wh.add(0.0, _whir(cfg.get("whir_hz", 900.0), cfg.get("whir_rate", 4)), 1.0)
            layers.append(wh)

    if cfg.get("mel"):
        mc = cfg["mel"]
        ml = Layer("mel", dry=0.55, rev=0.55, echo=0.4, hp=250, tau=2.5)
        tm = [[(0, 3), (3, 1), (4, 2), (6, 2), (8, 4), (12, 4)], [(0, 2), (2, 2), (4, 4), (10, 2), (12, 4)],
              [(0, 4), (4, 1), (5, 1), (6, 2), (8, 6)], [(0, 2), (3, 3), (8, 2), (10, 2), (12, 4)]]
        melody(ml, mc.get("inst", "vibes"), 0, E.BARS - E.BARS % 4, [11, 23, 37, 51], tm, CH, SC, mc.get("v", 0.28),
               mc.get("pan", 0.15), mc.get("lo", 67), mc.get("hi", 84), slot_beats=0.5, per=4)
        layers.append(ml)
    return layers


def run(cfg):
    return E.run(lambda: build_track(cfg))


if __name__ == "__main__":
    sys.exit("labkit 은 compose_<id>.py 가 가져다 쓰는 모듈입니다")
