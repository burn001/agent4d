// node --test "web/test/bgm.test.mjs"   배경음악 곡 목록·곡 선택: 매니페스트·선택값·순환·무작위·loop
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseManifest, normalizeSel, firstTrack, nextTrack, loopFor, optionList, isMode, TRACK_KEY, trackUrl } from '../bgm-core.mjs';

const ASSETS = new URL('../assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('bgm-tracks.json', ASSETS), 'utf8'));
const T = (ids) => ids.map((id) => ({ id, label: id, title: id, file: id + '.mp3' }));

test('레포 매니페스트: 앰비언트·로파이·재즈·작은 도시·칠홉(+이후 곡), 기본 로파이, 파일·메타 존재, 300초, 단계·energy', () => {
  const m = parseManifest(manifest);
  assert.ok(m);
  assert.deepEqual(m.tracks.slice(0, 5).map((t) => t.id), ['ambient', 'lofi', 'jazz', 'city', 'chillhop']);
  assert.deepEqual(m.tracks.slice(0, 5).map((t) => t.label), ['앰비언트', '로파이', '재즈', '작은 도시', '칠홉']);
  assert.equal(m.def, 'lofi');
  assert.equal(m.tracks[0].file, 'bgm.mp3', '기존 bgm.mp3 = 앰비언트 유지');
  for (const t of m.tracks) {
    // mp3 는 공개판 레포에 없고 Releases 자산으로 받는다 — 있을 때만 크기를 본다(메타 json 은 늘 있음)
    if (existsSync(new URL(t.file, ASSETS))) {
      const size = statSync(new URL(t.file, ASSETS)).size;
      assert.ok(size > 1e6 && size <= 8e6, `${t.file} 크기 ${size}`);
    }
    const meta = JSON.parse(readFileSync(new URL(t.meta, ASSETS), 'utf8'));
    assert.equal(meta.duration, 300);
    assert.ok(Array.isArray(meta.sections) && meta.sections.length >= 2);
    assert.equal(t.bpm, meta.bpm);
    assert.ok(t.title && t.key);
    assert.ok(t.stage.length >= 1, `${t.id} 단계(stage)`);
    assert.ok(t.energy >= 0 && t.energy <= 1, `${t.id} energy 0～1`);
  }
});

test('parseManifest: 깨진 항목·중복·모드 이름 id 는 버림, 비면 null, 기본값 보정', () => {
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest({ tracks: [] }), null);
  const m = parseManifest({ default: 'nope', tracks: [{ id: 'a', file: 'a.mp3' }, { id: 'a', file: 'b.mp3' }, { id: 'cycle', file: 'c.mp3' }, { file: 'x.mp3' }, { id: 'lofi', file: 'l.mp3' }] });
  assert.deepEqual(m.tracks.map((t) => t.id), ['a', 'lofi']);
  assert.equal(m.def, 'lofi');
  assert.equal(parseManifest({ tracks: [{ id: 'z', file: 'z.mp3' }] }).def, 'z');
});

test('선택값: 저장값 검사(모르는 값 → 기본 로파이), 첫 곡은 선택 곡 또는 마지막 곡', () => {
  const tr = T(['ambient', 'lofi', 'jazz', 'city']);
  assert.equal(TRACK_KEY, 'ccviz.bgm.track');
  assert.equal(normalizeSel(null, tr), 'lofi');
  assert.equal(normalizeSel('없는곡', tr), 'lofi');
  assert.equal(normalizeSel('jazz', tr), 'jazz');
  assert.equal(normalizeSel('shuffle', tr), 'shuffle');
  assert.equal(firstTrack('city', tr, 'jazz'), 'city');
  assert.equal(firstTrack('cycle', tr, 'jazz'), 'jazz');
  assert.equal(firstTrack('cycle', tr, null), 'lofi');
  assert.equal(firstTrack('shuffle', tr, '지워진곡'), 'lofi');
});

test('순환: 목록 다음 곡, 끝이면 처음 / 무작위: 지금 곡이 아닌 곡 / loop 는 곡 하나일 때만', () => {
  const tr = T(['ambient', 'lofi', 'jazz', 'city']);
  assert.equal(nextTrack('cycle', tr, 'lofi'), 'jazz');
  assert.equal(nextTrack('cycle', tr, 'city'), 'ambient');
  assert.equal(nextTrack('cycle', tr, '모름'), 'ambient');
  for (const r of [0, 0.3, 0.6, 0.999]) assert.notEqual(nextTrack('shuffle', tr, 'jazz', () => r), 'jazz');
  assert.equal(nextTrack('shuffle', tr, 'jazz', () => 0), 'ambient');
  assert.equal(nextTrack('shuffle', tr, 'jazz', () => 0.999), 'city');
  assert.equal(nextTrack('shuffle', T(['solo']), 'solo', () => 0.5), 'solo');
  assert.equal(loopFor('lofi'), true);
  assert.equal(loopFor('cycle'), false);
  assert.equal(loopFor('shuffle'), false);
  assert.ok(isMode('cycle') && !isMode('lofi'));
  const o = optionList(tr);
  assert.deepEqual(o.map((x) => x.value), ['auto', 'ambient', 'lofi', 'jazz', 'city', 'cycle', 'shuffle']);
  assert.equal(o[0].text, '자동(상황 맞춤)');
  assert.deepEqual(o.map((x) => x.group), [null, '기타', '기타', '기타', '기타', null, null]);
  // 단계별 묶음: 가장 낮은 단계 묶음에 한 번, 묶음 안은 energy 순
  const st = optionList(parseManifest(manifest).tracks);
  // 곡이 늘어도 깨지지 않게 실제 매니페스트에선 규칙만 본다: 묶음은 단계 순, 묶음 안은 energy 오름차순, 곡마다 한 번
  const STAGE_ORDER = ['한가', '보통', '활발', '매우 활발'];
  const grouped = st.filter((x) => x.group && x.group !== '기타');
  const byId = new Map(parseManifest(manifest).tracks.map((t) => [t.id, t]));
  assert.equal(new Set(grouped.map((x) => x.value)).size, grouped.length);
  for (let i = 1; i < grouped.length; i++) {
    const a = grouped[i - 1], b = grouped[i];
    const ga = STAGE_ORDER.indexOf(a.group), gb = STAGE_ORDER.indexOf(b.group);
    assert.ok(ga <= gb, `${a.group} → ${b.group}`);
    if (ga === gb) assert.ok((byId.get(a.value).energy ?? 0) <= (byId.get(b.value).energy ?? 0), `${a.value} ≤ ${b.value}`);
  }
  assert.ok(grouped.some((x) => x.group === '한가') && grouped.some((x) => x.group === '보통'));
  assert.match(st.find((x) => x.value === 'city').title, /활발·매우 활발/);
  assert.deepEqual(o.slice(-2).map((x) => x.text), ['순환', '무작위']);
});

test('audio.js: 선택기·ended·저장 키·<audio> 두 덱(§73 크로스페이드, 필터는 ctx-ui 가 출력 뒤에 끼움)', () => {
  const src = readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
  assert.match(src, /bgm-tracks\.json/);
  assert.match(src, /addEventListener\('ended'/);
  assert.match(src, /id = 'bgm-track'/);
  // 덱은 정확히 두 개: index.html 의 #bgm + audio.js 가 만드는 #bgm-b. 전환마다 새 요소를 만들지 않는다(MediaElementSource 는 요소당 한 번)
  assert.equal((src.match(/createElement\('audio'\)/g) || []).length, 1);
  assert.doesNotMatch(src, /new Audio\(/);
  assert.match(src, /createMediaElementSource\(d\.el\)/);
  assert.doesNotMatch(src, /removeAttribute\('src'\)/, '꺼진 덱은 src 를 비우지 않고 재사용');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<audio id="bgm"/);
  const ctxUi = readFileSync(new URL('../ctx-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ctxUi, /createMediaElementSource/, '요소 연결은 audio.js 한 곳에서');
});

test('영어 화면(§86): 매니페스트 *_en 필드로 곡 이름·제목·설명, 없으면 기존 이름 · 단계·묶음·자동 문구·구간 이름', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  const { autoLabel } = await import('../bgm-auto.mjs');
  const { soundLabel } = await import('../sound-gate.mjs');
  const { sectionName } = await import('../bgm-core.mjs');
  _setLangForTest('en');
  try {
    const m = parseManifest({ sections_en: { 기: 'Opening' }, tracks: [
      { id: 'jazz', label: '재즈', title: '모퉁이 카페', mood: '재즈풍', label_en: 'Jazz', title_en: 'Corner Café', mood_en: 'Jazzy', file: 'a.mp3', stage: 1 },
      { id: 'x', label: '새 곡', file: 'b.mp3' },
    ] });
    assert.deepEqual([m.tracks[0].label, m.tracks[0].title, m.tracks[0].mood], ['Jazz', 'Corner Café', 'Jazzy']);
    assert.equal(m.tracks[1].label, '새 곡');
    const o = optionList(m.tracks);
    assert.equal(o[0].text, 'Auto (match activity)');
    assert.deepEqual(o.map((x) => x.group), [null, 'Normal', 'Other', null, null]);
    assert.match(o[1].title, /Auto levels: Normal/);
    assert.equal(autoLabel(m.tracks[0], 2), 'Auto · Jazz (Busy)');
    assert.equal(soundLabel('on').text, 'Sound on');
    assert.equal(sectionName('기', m.sectionsEn), 'Opening');
    assert.equal(sectionName('모름', m.sectionsEn), '모름');
    // 실제 매니페스트: 모든 곡에 영어 이름
    for (const t of parseManifest(manifest).tracks) assert.ok(!/[가-힣]/.test(t.label), t.id);
  } finally { _setLangForTest('ko'); }
  assert.equal(parseManifest({ tracks: [{ id: 'jazz', label: '재즈', label_en: 'Jazz', file: 'a.mp3' }] }).tracks[0].label, '재즈');
  assert.equal(sectionName('기', { 기: 'Opening' }), '기');
});

test('§130 버전 주소: 매니페스트 hash = 곡 내용 sha256 앞 16자, trackUrl 은 ?v=<hash>, 해시 없거나 이상하면 예전 주소', () => {
  const m = parseManifest(manifest);
  for (const t of m.tracks) {
    assert.match(t.hash || '', /^[0-9a-f]{16}$/, `${t.id} hash`);
    assert.equal(trackUrl(t), `assets/${t.file}?v=${t.hash}`);
    if (existsSync(new URL(t.file, ASSETS))) {
      const hex = createHash('sha256').update(readFileSync(new URL(t.file, ASSETS))).digest('hex');
      assert.equal(t.hash, hex.slice(0, 16), `${t.file} 해시가 낡음 — python music/tracks.py manifest`);
    }
  }
  const p = parseManifest({ tracks: [{ id: 'a', file: 'a.mp3', hash: 'XYZ' }, { id: 'b', file: 'b.mp3' }, { id: 'c', file: 'c.mp3', hash: 'ABCDEF0123456789' }] });
  assert.deepEqual(p.tracks.map(trackUrl), ['assets/a.mp3', 'assets/b.mp3', 'assets/c.mp3?v=abcdef0123456789']);
  assert.equal(trackUrl(null), null);
});

test('§155 곡 CDN: cdn_base 검사·키 bgm/<hash>/<file>·CDN 우선·끔 스위치·실패하면 한동안 로컬', async () => {
  const { parseCdnBase, cdnObjectKey, cdnTrackUrl, cdnWanted, TrackSource, CDN_KEY, CDN_DOWN_MS } = await import('../bgm-core.mjs');
  assert.equal(parseCdnBase('https://m.example.dev/'), 'https://m.example.dev');
  assert.equal(parseCdnBase('https://m.example.dev/a/b//'), 'https://m.example.dev/a/b');
  for (const v of [null, '', 'http://m.example.dev', 'https://m.example.dev/?x=1', 'https://u:p@m.example.dev', 'https://m.example.dev/#a', 'javascript:alert(1)', 12]) assert.equal(parseCdnBase(v), null, String(v));
  const t = { id: 'lofi', file: 'bgm-lofi.mp3', hash: '0123456789abcdef' };
  assert.equal(cdnObjectKey(t), 'bgm/0123456789abcdef/bgm-lofi.mp3');
  assert.equal(cdnObjectKey({ ...t, hash: null }), null);
  assert.equal(cdnObjectKey({ ...t, file: '../x.mp3' }), null);
  assert.equal(cdnTrackUrl(t, 'https://m.example.dev/'), 'https://m.example.dev/bgm/0123456789abcdef/bgm-lofi.mp3');
  assert.equal(cdnTrackUrl(t, null), null);
  // 끔 스위치: ?bgmcdn=0|1 > localStorage ccviz.bgm.cdn > 켬
  assert.equal(cdnWanted({ search: '' }), true);
  assert.equal(cdnWanted({ search: '?bgmcdn=0' }), false);
  assert.equal(cdnWanted({ search: '' }, (k) => (k === CDN_KEY ? '0' : null)), false);
  assert.equal(cdnWanted({ search: '?t=x&bgmcdn=1' }, () => '0'), true);
  assert.equal(cdnWanted({ search: '' }, () => { throw new Error('blocked'); }), true);
  // 주소 고르기
  let now = 1000;
  const s = new TrackSource({ base: 'https://m.example.dev', enabled: true, now: () => now });
  const cdn = 'https://m.example.dev/bgm/0123456789abcdef/bgm-lofi.mp3';
  assert.equal(s.url(t), cdn);
  assert.equal(s.url({ id: 'b', file: 'b.mp3' }), 'assets/b.mp3', '해시 없는 곡은 로컬');
  assert.equal(s.local(t), 'assets/bgm-lofi.mp3?v=0123456789abcdef');
  assert.equal(s.isCdn(cdn), true);
  assert.equal(s.isCdn('assets/bgm-lofi.mp3?v=0123456789abcdef'), false);
  assert.equal(s.isCdn('https://m.example.dev.evil/x'), false);
  s.fail(cdn, 'error');
  assert.equal(s.down, true);
  assert.equal(s.url(t), s.local(t), '실패 뒤 로컬');
  now += CDN_DOWN_MS + 1;
  assert.equal(s.url(t), cdn, '시간이 지나면 다시 CDN');
  assert.equal(new TrackSource({ base: 'https://m.example.dev', enabled: false }).url(t), s.local(t), '끄면 로컬');
  assert.equal(new TrackSource({ base: null }).url(t), s.local(t), 'cdn_base 없으면 로컬');
  assert.equal(parseManifest({ cdn_base: 'https://m.example.dev/', tracks: [t] }).cdnBase, 'https://m.example.dev');
  assert.equal(parseManifest({ tracks: [t] }).cdnBase, null);
});

test('§155 레포: cdn_base 가 있으면 https·CSP media-src·connect-src 에 그 출처, tracks.py CDN_BASE 도 CSP 에', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const dir = (n) => (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(n + ' ')) || '').split(/\s+/);
  const py = readFileSync(new URL('../../music/tracks.py', import.meta.url), 'utf8');
  const base = /^CDN_BASE = "([^"]+)"/m.exec(py)[1];
  const origins = [new URL(base).origin];
  if (manifest.cdn_base) { assert.match(manifest.cdn_base, /^https:\/\//); origins.push(new URL(manifest.cdn_base).origin); }
  for (const o of origins) {
    assert.ok(dir('media-src').includes(o), `media-src 에 ${o}`);
    assert.ok(dir('connect-src').includes(o), `connect-src 에 ${o}(외부 접속 통째 받기 fetch)`);
  }
});

test('§155 audio.js 연결: 덱 주소는 TrackSource, 오류·시간 초과면 로컬로 되돌림, 통째 받기 실패도 로컬, play 한 번 더', () => {
  const src = readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /trackUrl\(/, '덱 주소는 this._url(t) 로만');
  assert.match(src, /new TrackSource\(\{ base: m\.cdnBase, enabled: cdnWanted\(location, lsGet\) \}\)/);
  assert.match(src, /addEventListener\('error', \(\) => this\._cdnFallback\(i, 'error'\)\)/);
  assert.match(src, /addEventListener\('loadstart', \(\) => this\._cdnWatch\(i\)\)/);
  assert.match(src, /this\._cdnFallback\(i, 'timeout'\)/);
  assert.match(src, /this\._cdnFallback\(i, 'stall'\)/, '재생 중 멈춤(waiting)도 로컬로');
  assert.match(src, /f\.cancelled\.has\(url\)/, '취소는 되돌림 아님');
  assert.match(src, /this\.source\.fail\(url, 'fetch'\)/);
  assert.match(src, /el\.currentTime = pos/, '되돌린 뒤 재생 위치 이음');
  assert.match(src, /async _playEl\(d\)/);
});
