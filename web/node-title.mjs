// 세션 노드 부제: 서버가 세션·claude -p 노드에 싣는 meta.title(aiTitle 또는 첫 프롬프트 요약, redact 완료, ≤120자)을
// 라벨(역할 표기 "메인 · <프로젝트>", "claude -p · …") 아래 작은 한 줄로. 라벨이 customTitle 이면 같은 말이 되므로 생략.
// 순수(DOM·three 없음). node --test 로 시험(web/test/node-title.test.mjs).

/** 제어 문자(코드 0～31·127)는 공백으로, 공백류(줄 구분자 포함)는 하나로 */
function clean(s) {
  let out = '';
  for (const ch of String(s ?? '')) { const c = ch.charCodeAt(0); out += c < 32 || c === 127 ? ' ' : ch; }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * 화면 부제는 쓰지 않는다(사용자: 첫 프롬프트를 에이전트 부제로 보이는 것은 "not cool"). 노드 라벨·복셀 이름표·툴팁이 이 함수를
 * 거치므로 늘 '' 를 돌려 모두 사라진다. 예전 규칙은 sessionTitleOf 로 남겨 둠(목록·시험용)
 */
export function nodeSubtitle() { return ''; }

/** 예전 부제 규칙: meta.title, 없거나 라벨과 같으면 ''. max 를 넘으면 말줄임 */
export function sessionTitleOf(node, max = 120) {
  const m = node && node.meta;
  if (!m || m.customTitle) return '';
  const t = clean(m.title);
  if (!t) return '';
  const label = clean(node.label);
  if (t === label || (label.length > 6 && label.endsWith(t))) return '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
