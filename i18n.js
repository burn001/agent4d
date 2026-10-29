// Agent4D 공유 페이지 EN / 한국어 전환 + 최신 Release 표시
(function () {
  var T = {
    en: {
      title: 'Agent4D · Visual Companion for Lonely Vibecoders — your coding agents in 3D space + time',
      tagline: 'Visual Companion for Lonely Vibecoders',
      sub: 'Your coding agents in 3D space + time — a live viewer and replayer for Claude Code sessions.',
      gh: '★ View on GitHub',
      rel: 'Latest release',
      tell: 'Tell Claude Code',
      prompt: 'Install Agent4D from https://github.com/burn001/agent4d — clone it to ~/agent4d, link its skills/agent4d folder into ~/.claude/skills/agent4d (a junction on Windows), then start it and give me the link.',
      copy: 'Copy', copied: 'Copied',
      f1: 'Main agent, subagents, workflows, <code>claude -p</code> sessions and background commands, streamed live from local transcripts (read-only).',
      f2: 'Three views — Flow, Planet and Voxel Office — in 3D or lightweight 2D.',
      f3: 'Replay past sessions, see context usage and plan limits, and follow every project on your machine at once.',
      foot: 'Apache-2.0 · © burn001 (Dr. Cho, Sangkyu) · Not affiliated with Anthropic.'
    },
    ko: {
      title: 'Agent4D · 외로운 바이브코더의 친구 — 3D 공간과 시간 속 코딩 에이전트',
      tagline: '외로운 바이브코더의 친구',
      sub: '3D 공간과 시간 속에서 움직이는 코딩 에이전트 — Claude Code 세션을 실시간으로 보고, 지난 세션을 다시 재생하는 뷰어입니다.',
      gh: '★ GitHub에서 보기',
      rel: '최신 릴리스',
      tell: 'Claude Code에 이렇게 말하세요',
      prompt: 'https://github.com/burn001/agent4d 에서 Agent4D 를 설치해 줘. ~/agent4d 에 클론하고, skills/agent4d 폴더를 ~/.claude/skills/agent4d 로 연결(Windows 는 정션)한 뒤, 실행해서 링크를 알려 줘.',
      copy: '복사', copied: '복사했습니다',
      f1: '메인 에이전트와 서브에이전트, 워크플로, <code>claude -p</code> 세션, 백그라운드 명령까지 이 PC의 대화 기록(transcript)을 읽어 실시간으로 보여 줍니다(읽기 전용).',
      f2: '흐름(Flow)·Planet·복셀 오피스(Voxel Office) 세 가지 화면을 3D로, 또는 가벼운 2D로 볼 수 있습니다.',
      f3: '지난 세션을 다시 보고, 컨텍스트 사용률과 요금제 사용 한도를 확인하고, 이 PC의 모든 프로젝트를 한 화면에서 함께 지켜볼 수 있습니다.',
      foot: 'Apache-2.0 · © burn001 (Dr. Cho, Sangkyu) · Anthropic과는 관계없는 개인 프로젝트입니다.'
    }
  };
  var KEY = 'agent4d-lang';
  var root = document.documentElement;
  var fixed = root.getAttribute('data-page-lang'); // ko 공유 페이지면 'ko'
  var rel = null; // 최신 Release 정보
  var lang;

  function pick() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    if (q === 'ko' || q === 'en') return q;
    if (fixed) return fixed;
    try { var s = localStorage.getItem(KEY); if (s === 'ko' || s === 'en') return s; } catch (e) {}
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return /^ko/i.test(nav) ? 'ko' : 'en';
  }

  function relText() {
    return T[lang].rel + (rel ? ' · ' + rel.v : '');
  }

  function apply(l) {
    lang = l;
    var t = T[l];
    root.lang = l;
    document.title = t.title;
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute('data-i18n');
      if (k in t) els[i].innerHTML = t[k];
    }
    document.getElementById('rel').textContent = relText();
    var btns = document.querySelectorAll('.lang a');
    for (var j = 0; j < btns.length; j++) {
      var on = btns[j].getAttribute('data-lang') === l;
      btns[j].classList.toggle('on', on);
      if (on) btns[j].setAttribute('aria-current', 'true'); else btns[j].removeAttribute('aria-current');
    }
  }

  function choose(l, ev) {
    try { localStorage.setItem(KEY, l); } catch (e) {}
    if (fixed && l !== fixed) return; // ko 페이지에서 EN 을 누르면 링크(../?lang=en)로 이동
    if (ev) ev.preventDefault();
    apply(l);
    try {
      var u = new URL(location.href);
      if (fixed) u.searchParams.delete('lang'); else u.searchParams.set('lang', l);
      history.replaceState(null, '', u);
    } catch (e) {}
  }

  var links = document.querySelectorAll('.lang a');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (ev) { choose(this.getAttribute('data-lang'), ev); });
  }

  var copyBtn = document.getElementById('copy');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var txt = document.getElementById('prompt').textContent;
    var done = function () {
      copyBtn.textContent = T[lang].copied;
      setTimeout(function () { copyBtn.textContent = T[lang].copy; }, 1600);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, function () {});
  });

  apply(pick());

  // 최신 Release 를 그때그때 읽어 버전·날짜 표시(실패하면 정적 링크 그대로). Release 제목 원문은 그대로 둔다.
  fetch('https://api.github.com/repos/burn001/agent4d/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (d) {
      rel = { v: d.tag_name };
      var a = document.getElementById('rel');
      a.textContent = relText();
      a.href = d.html_url;
      var day = (d.published_at || '').slice(0, 10);
      var t = (d.name || '').replace(/^v[\d.]+:\s*/, '');
      if (t === d.tag_name) t = '';
      var el = document.getElementById('ver');
      el.textContent = d.tag_name + (day ? ' · ' + day : '') + (t ? ' — ' + t : '');
      el.hidden = false;
    })
    .catch(function () {});
})();
