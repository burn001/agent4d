// HTML 이스케이프(순수, three·DOM 없음). scene.js(3D)와 panel.js·2D 표현이 같이 쓴다 — panel.js 가 scene.js 를 정적 import 해
// 2D 화면에서도 three.js 를 끌어오던 것을 끊으려고 따로 뺐다. scene.js 는 같은 함수를 다시 내보낸다.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
