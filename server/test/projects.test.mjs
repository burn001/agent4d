// 3차: 프로젝트 이름 복원·활성 판정·/projects 집계 (합성 데이터만)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeOverviewFixture, OV, CWD, enc } from './fixtures/overview-build.mjs';
import { SessionIndex, pidAlive } from '../discovery.mjs';
import { assignNames, baseName, guessPathFromId, isTempPath, buildProjects } from '../projects.mjs';

let fx, index;
before(async () => {
  fx = makeOverviewFixture();
  index = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions });
  await index.refresh();
});
after(() => fx?.rm());

test('이름 규칙: 짧은·숫자 마지막 구간은 앞 구간을 붙이고, 겹치면 더 붙인다', () => {
  assert.equal(baseName('D:\\work\\Projects\\2026'), 'Projects\\2026');
  assert.equal(baseName('D:\\DEV_REPOS\\demo_api'), 'demo_api');
  assert.equal(baseName('/home/u/src/app'), 'src/app');
  const long = 'D:\\' + 'x'.repeat(60);
  assert.ok(baseName(long).length <= 40 && baseName(long).startsWith('…'));
  const names = assignNames([
    { projectId: 'p1', path: 'D:\\a\\client\\web' }, { projectId: 'p2', path: 'D:\\b\\server\\web' },
    { projectId: 'p3', path: 'C:\\Users\\X\\AppData\\Local\\Temp\\claude\\s\\scratchpad\\probe', temp: true },
  ]);
  assert.equal(names.get('p1'), 'client\\web');
  assert.equal(names.get('p2'), 'server\\web');
  assert.equal(names.get('p3'), '(임시) probe');
});

test('임시 폴더 판정·역인코딩 추정', () => {
  assert.ok(isTempPath(CWD.temp));
  assert.ok(!isTempPath(CWD.works));
  assert.ok(isTempPath(null, enc(CWD.temp)));
  assert.equal(guessPathFromId('D--work-Projects-2026'), 'D:\\work\\Projects\\2026');
});

test('pid 생존: 이 프로세스는 살아 있고, 죽은 pid 는 live 가 아니다', () => {
  assert.ok(pidAlive(process.pid));
  assert.ok(!pidAlive(-1));
  const live = index.liveProcs().map((p) => p.sessionId);
  assert.ok(live.includes(OV.a1) && live.includes(OV.b1) && live.includes(OV.orphan));
  assert.ok(!live.includes(OV.dead));
  // 1·2차 live 맵(/sessions 의 live 필드)은 그대로: pid 파일만 있으면 들어 있다
  assert.ok(index.live.has(OV.dead));
});

test('/projects 집계: 사람이 읽는 이름, live 수, 정렬, 한글 폴더는 transcript cwd 로 복원', async () => {
  const { projects } = await buildProjects(index, {});
  const by = new Map(projects.map((p) => [p.projectId, p]));
  const w = by.get(enc(CWD.works));
  assert.equal(w.name, 'Projects\\2026');
  assert.equal(w.path, CWD.works);
  assert.equal(w.nameGuessed, false);
  assert.equal(w.live, true);
  assert.equal(w.liveSessions, 1);
  assert.equal(w.busySessions, 1);
  assert.equal(w.sessions, 2);
  assert.ok(w.recentList.some((r) => r.sessionId === OV.aOld && r.tier === 'recent' && r.title === '지난 작업 세션'));
  assert.ok(w.liveList[0].title === '전체 보기 작업' && w.liveList[0].inOverview);
  const a = by.get(enc(CWD.appdb));
  assert.equal(a.name, 'demo_api');
  assert.equal(a.liveSessions, 2); // b1 + 독립 sdk-cli
  assert.ok(a.liveList.some((x) => x.sessionId === OV.orphan && x.entrypoint === 'sdk-cli'));
  const k = by.get(enc(CWD.korean));
  assert.equal(k.path, CWD.korean);
  assert.equal(k.name, 'Research');
  // 죽은 pid·40일 전 프로젝트는 기본 목록에 없음, inactive=1 이면 있음
  assert.ok(!by.has(enc(CWD.dead)));
  const all = await buildProjects(index, { inactive: true });
  assert.ok(all.projects.some((p) => p.projectId === enc(CWD.dead) && !p.live && p.tier === 'inactive'));
  // 아직 아무 루트도 매칭하지 않은 live sdk-cli 는 독립 루트라 그 임시 폴더 프로젝트가 '(임시)' 로 보인다
  const t0 = by.get(enc(CWD.temp));
  assert.ok(t0 && t0.temp && t0.name.startsWith('(임시) ') && t0.liveList[0].inOverview);
  // 부모가 claude -p 로 매칭하면(자식은 부모 클러스터) 임시 폴더 프로젝트는 기본 제외, temp=1 이면 '(임시)' + isChild
  index.claimedChildren.add(OV.child);
  const p2 = (await buildProjects(index, {})).projects;
  assert.ok(!p2.some((p) => p.projectId === enc(CWD.temp)));
  const withTemp = await buildProjects(index, { temp: true });
  const t = withTemp.projects.find((p) => p.projectId === enc(CWD.temp));
  assert.ok(t && t.temp && t.name.startsWith('(임시) ') && t.liveList[0].isChild === true);
  index.claimedChildren.delete(OV.child);
  // live 프로젝트가 먼저
  const firstNonLive = projects.findIndex((p) => !p.live);
  assert.ok(firstNonLive === -1 || projects.slice(firstNonLive).every((p) => !p.live));
  // pid 는 내보내지 않는다
  assert.ok(!JSON.stringify(projects).includes('"pid"'));
});

test('config.project 가 있으면 그 프로젝트만', async () => {
  const idx = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions, project: enc(CWD.appdb) });
  await idx.refresh();
  const { projects } = await buildProjects(idx, { inactive: true, temp: true });
  assert.deepEqual(projects.map((p) => p.projectId), [enc(CWD.appdb)]);
});

test('제목 대체: 60자 경계에 걸친 비밀도 마스킹 후 자른다 · 허브가 잠들어도 inOverview 는 총량 상한(maxWithInactive)', async () => {
  const f2 = makeOverviewFixture();
  try {
    const fs = await import('node:fs'), path = await import('node:path');
    const cwd = 'D:\tmp\secret-proj';
    const dir = path.join(f2.projects, enc(cwd)); fs.mkdirSync(dir, { recursive: true });
    const sid = '5e5e5e5e-0000-4000-8000-00000000005e';
    // 'sk-ant-' 가 48자 근처에서 시작 → 60자에서 자르면 앞부분만 남는다(예전 순서면 그대로 노출)
    const prompt = 'deploy with api_key=ABCDEFGHIJKLMNOP and also the sk-ant-api03-FAKEFAKEFAKEFAKEFAKE please';
    f2.write(path.join(dir, `${sid}.jsonl`), [{ type: 'user', timestamp: f2.T(1), sessionId: sid, cwd, version: '2.1.309', entrypoint: 'cli', origin: { kind: 'human' }, message: { role: 'user', content: prompt } }]);
    fs.writeFileSync(path.join(f2.sessions, '201.json'), JSON.stringify({ pid: process.pid, sessionId: sid, cwd, status: 'idle', entrypoint: 'cli', kind: 'interactive' }));
    const idx = new SessionIndex({ projectsDir: f2.projects, sessionsDir: f2.sessions });
    await idx.refresh();
    const { projects } = await buildProjects(idx, { inactive: true, temp: true });
    const titles = JSON.stringify(projects.flatMap((p) => [...(p.liveList || []), ...(p.recentList || [])].map((s) => s.title)));
    assert.ok(!titles.includes('sk-ant-api'), titles);
    assert.ok(!titles.includes('ABCDEFGH'), titles);
    const sl = await idx.list(30);
    const arr = Array.isArray(sl) ? sl : sl.sessions;
    const st = JSON.stringify(arr.find((x) => x.sessionId === sid)?.title);
    assert.ok(st && !st.includes('sk-ant-api') && !st.includes('ABCDEFGH'), st); // 첫 프롬프트는 제목이 아님(sid8)
    // 상한: 메인 cli 4개(a1·b1·k1·secret) 중 maxRoots=2, sdk(child·orphan) 를 더해도 합 3을 넘지 않는다
    const capped = await buildProjects(idx, { inactive: true, temp: true, maxRoots: 2, maxWithInactive: 3 });
    const inOv = capped.projects.flatMap((p) => (p.liveList || []).filter((s) => s.inOverview && !s.isChild));
    assert.equal(inOv.length, 3, JSON.stringify(inOv.map((s) => s.sessionId.slice(0, 4))));
  } finally { f2.rm(); }
});
