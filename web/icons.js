// 도구 종류(cat) 이름표 — cat 문자열은 서버 parse.mjs toolCategory 와 같다.
// 도형 모드의 도구 그림은 홀로그램 모니터(holo.js·holo-core.mjs)가 맡는다(예전 궤도 아이콘은 없앰).

import { t } from './i18n.mjs';

export const CATS = ['shell', 'read', 'write', 'edit', 'search', 'agent', 'workflow', 'skill',
  'web', 'monitor', 'mcp', 'artifact', 'notify', 'other'];

export const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c, t('app.cat.' + c)]));

/** 서버가 cat 을 안 붙였을 때만 쓰는 대체 분류 (서버 규칙과 동일) */
export function toolCategory(name = '') {
  if (name.startsWith('mcp__')) return 'mcp';
  const m = {
    Bash: 'shell', PowerShell: 'shell', Read: 'read', NotebookRead: 'read', Write: 'write',
    Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Grep: 'search', Glob: 'search', ToolSearch: 'search',
    Agent: 'agent', Task: 'agent', SendMessage: 'agent', TaskOutput: 'agent', Workflow: 'workflow',
    Skill: 'skill', WebFetch: 'web', WebSearch: 'web', Monitor: 'monitor', TaskStop: 'monitor',
    CronCreate: 'monitor', CronDelete: 'monitor', CronList: 'monitor', Artifact: 'artifact',
    ArtifactComments: 'artifact', ArtifactData: 'artifact', PushNotification: 'notify', SendUserFile: 'notify',
  };
  return m[name] || 'other';
}
