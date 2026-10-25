// 복셀 오피스 색. 노드·상태색은 테마 토큰(--k-* --ok --error --skill)을 그대로 쓰고,
// 가구·바닥만 여기 표를 쓴다.
import * as THREE from 'three';
import { DARK, LIGHT, SKIN } from './palette-hex.mjs';

const TOKEN_NAMES = ['bg', 'fog', 'grid', 'link', 'text', 'muted', 'k-main', 'k-subagent', 'k-workflow',
  'k-workflow-agent', 'k-claude-p', 'k-bash-bg', 'k-monitor', 'ok', 'error', 'skill', 'stopped', 'link-spawn',
  'flow-call', 'sess-0', 'sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5', 'sess-6', 'sess-7', 'conflict'];

/** scene.js readTokens() 와 같은 모양(THREE.Color 값 + isLight) */
export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const t = {};
  for (const n of TOKEN_NAMES) {
    const v = cs.getPropertyValue('--' + n).trim();
    t[n] = new THREE.Color(v || '#888888');
  }
  t.isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return t;
}

/** 테마별 팔레트: 이름 → THREE.Color (배열 값은 Color 배열) */
export function palette(isLight) {
  const src = isLight ? LIGHT : DARK;
  const p = {};
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v)) p[k] = v.map((c) => new THREE.Color(c));
    else if (typeof v === 'string') p[k] = new THREE.Color(v);
    else p[k] = v;
  }
  p.skin = SKIN.map((c) => new THREE.Color(c));
  p.isLight = !!isLight;
  return p;
}

export const PALETTE_HEX = { dark: DARK, light: LIGHT, skin: SKIN };
