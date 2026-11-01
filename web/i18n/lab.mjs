// 다국어 사전 — 영역 'lab'(복셀 연구소). 키는 'lab.' 으로 시작, en·ko 키 집합이 같아야 한다(web/test/i18n.test.mjs).
// 담당별 절로 나눠 둔다 — 자기 절 안에만 키를 더한다(다른 절과 줄이 붙지 않게 빈 줄 유지, rebase 충돌 줄이기).
// 표현 이름·범례(app.*)·장면 이름(scene.*)·2D 이름(flat.*)은 각 영역 파일(리드).
export default {
  en: {
    // ── 리드 ──
    'lab.platform.empty': 'No work targets yet',
    'lab.bridge': 'Bridge',

    // ── 플랫폼(작업 대상 층) ──
    'lab.sector.more': '…',
    'lab.platform.core': 'Repository core',
    'lab.platform.outbay': 'Output bay',
    'lab.platform.bundle': 'Bundled blocks',
    'lab.platform.wave': 'Bulk change',

    // ── 기자재 ──
    'lab.rig.tests': 'Test bench',
    'lab.rig.reactor': 'Reactor',
    'lab.rig.tank': 'Centrifuge tank',
    'lab.rig.antenna': 'Comms antenna',
    'lab.rig.scope': 'Watch scope',
    'lab.rig.incubator': 'Incubator',
    'lab.rig.oscillo': 'Oscilloscope rack',
    'lab.rig.dispenser': 'Dispensing robot',
    'lab.rig.meter': 'Multimeter',
    'lab.rig.sequencer': 'Auto sequencer',
    'lab.state.run': 'Running',
    'lab.state.wait': 'Waiting',
    'lab.state.stale': 'Stalled',
    'lab.state.done': 'Done',
    'lab.state.fail': 'Failed',
    'lab.state.stop': 'Stopped',
    'lab.rig.rc': 'rc {n}',
    'lab.rig.stale': 'stalled {n} min',
    'lab.rig.shelfMore': '+{n}',
    'lab.rig.lift': 'Lowered on the floor lift',
    'lab.rig.card': 'Rig',
    'lab.rig.r.kind': 'Rig',
    'lab.rig.r.state': 'State',
    'lab.rig.r.gauge': 'Progress',
    'lab.rig.r.rc': 'Exit code',
    'lab.rig.r.stale': 'Quiet',

    // ── 캐릭터·책상·지휘석 ──
    'lab.walk.on': 'Lab: walk to the floor on',
    'lab.walk.title': 'Voxel Lab: staff walk to the platform edge or a rig for new files, dangerous operations and watched jobs (ctl labwalk on|off)',
    'lab.walk.off': 'Lab: walk to the floor off',
    'lab.zone': 'Zone {n}',
    'lab.comms': 'Comms screen',
    'lab.lounge': 'Lounge',
    'lab.walk.queue': 'Waiting at the rig',

    // ── 평면도(2D) ──

    // ── 음악·효과음 ──
    'lab.bgm.theme': 'Lab tracks',
    'lab.bgm.fallback': 'No lab tracks yet — playing the Voxel Office pool',
  },
  ko: {
    // ── 리드 ──
    'lab.platform.empty': '아직 작업 대상이 없습니다',
    'lab.bridge': '브리지',

    // ── 플랫폼(작업 대상 층) ──
    'lab.sector.more': '…',
    'lab.platform.core': '저장소 코어',
    'lab.platform.outbay': '산출물 반출대',
    'lab.platform.bundle': '묶음 블록',
    'lab.platform.wave': '대량 변경',

    // ── 기자재 ──
    'lab.rig.tests': '시험대',
    'lab.rig.reactor': '반응로',
    'lab.rig.tank': '원심 탱크',
    'lab.rig.antenna': '통신 안테나',
    'lab.rig.scope': '감시 스코프',
    'lab.rig.incubator': '배양기',
    'lab.rig.oscillo': '오실로스코프 랙',
    'lab.rig.dispenser': '분주 로봇',
    'lab.rig.meter': '범용 계측기',
    'lab.rig.sequencer': '자동 실험 시퀀서',
    'lab.state.run': '진행',
    'lab.state.wait': '대기',
    'lab.state.stale': '정체',
    'lab.state.done': '끝',
    'lab.state.fail': '실패',
    'lab.state.stop': '중지',
    'lab.rig.rc': 'rc {n}',
    'lab.rig.stale': '정체 {n}분',
    'lab.rig.shelfMore': '+{n}',
    'lab.rig.lift': '승강판으로 내려감',
    'lab.rig.card': '기자재',
    'lab.rig.r.kind': '기자재',
    'lab.rig.r.state': '상태',
    'lab.rig.r.gauge': '진행',
    'lab.rig.r.rc': '종료 코드',
    'lab.rig.r.stale': '정체',

    // ── 캐릭터·책상·지휘석 ──
    'lab.walk.on': '연구소: 현장 걷기 켬',
    'lab.walk.title': '복셀 연구소: 새 파일·위험 동작·지켜보는 작업이 있으면 직원이 플랫폼 가장자리나 기자재 앞으로 걸어감(ctl labwalk on|off)',
    'lab.walk.off': '연구소: 현장 걷기 끔',
    'lab.zone': '구역 {n}',
    'lab.comms': '통신 스크린',
    'lab.lounge': '라운지',
    'lab.walk.queue': '기자재 앞 대기',

    // ── 평면도(2D) ──

    // ── 음악·효과음 ──
    'lab.bgm.theme': '연구소 곡',
    'lab.bgm.fallback': '연구소 곡이 없어 복셀 오피스 곡으로 재생합니다',
  },
};
