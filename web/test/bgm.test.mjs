// node --test "web/test/bgm.test.mjs"   배경음악 곡 목록·곡 선택: 매니페스트·선택값·순환·무작위·loop
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseManifest, normalizeSel, firstTrack, nextTrack, loopFor, optionList, isMode, TRACK_KEY } from '../bgm-core.mjs';

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
