# Agent4D 소개 페이지 빌드: i18n.js 문구 + page_tpl.html 틀로 index.html(영어)·ko/index.html(한국어)을 함께 만든다.
# 사용법(gh-pages 클론 루트에서): python _build/build_pages.py .
# 문구를 고칠 때는 i18n.js 만 고치고 이 스크립트를 다시 돌린 뒤 커밋한다.
import sys, os, re
out = sys.argv[1]
B = 'https://burn001.github.io/agent4d/'
P = {
 'en': dict(lang='en', fixed='', base='', url=B, locale='en_US', alt='ko_KR',
   title='Agent4D · Visual Companion for Lonely Vibecoders — your coding agents in 3D space + time',
   desc='A local, read-only live 3D viewer and replayer for Claude Code sessions. Watch the main agent, subagents, background commands and tool calls as they happen.',
   ogdesc='A local, read-only live 3D viewer and replayer for Claude Code sessions. Open source (Apache-2.0).',
   twdesc='A local, read-only live 3D viewer and replayer for Claude Code sessions. Open source.',
   imgalt='Agent4D Planet view: the main agent as a tourbillon with tool panels around it',
   en_href='./', ko_href='ko/'),
 'ko': dict(lang='ko', fixed=' data-page-lang="ko"', base='../', url=B+'ko/', locale='ko_KR', alt='en_US',
   title='Agent4D · 외로운 바이브코더의 친구 — 3D 공간과 시간 속 코딩 에이전트',
   desc='Claude Code 세션을 3D로 실시간 보여 주고 지난 세션을 다시 재생하는 로컬 읽기 전용 뷰어입니다. 메인 에이전트와 서브에이전트, 백그라운드 명령, 도구 호출을 일어나는 그대로 볼 수 있습니다.',
   ogdesc='Claude Code 세션을 3D로 실시간 보여 주고 다시 재생하는 로컬 읽기 전용 뷰어. 오픈소스(Apache-2.0).',
   twdesc='Claude Code 세션을 3D로 실시간 보여 주고 다시 재생하는 로컬 읽기 전용 뷰어. 오픈소스.',
   imgalt='Agent4D Planet 화면: 투르비용 모양의 메인 에이전트와 그 둘레의 도구 패널',
   en_href='../?lang=en', ko_href='./'),
}
# 본문 문구는 i18n.js 와 같은 값을 정적으로 넣는다(미리보기 봇·JS 꺼진 브라우저용)
js = open(os.path.join(out, 'i18n.js'), encoding='utf-8').read()
def dict_of(l):
    m = re.search(l + r":\s*\{(.*?)\n    \}", js, re.S).group(1)
    return dict(re.findall(r"(\w+):\s*'((?:[^'\\]|\\.)*)'", m))

TPL = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'page_tpl.html'), encoding='utf-8').read()
for l, p in P.items():
    d = dict_of(l)
    d.pop('title', None)
    html = TPL.format(B=B, **p, **d)
    path = os.path.join(out, 'index.html' if l == 'en' else os.path.join('ko', 'index.html'))
    open(path, 'w', encoding='utf-8', newline='\n').write(html)
    print('wrote', path)
