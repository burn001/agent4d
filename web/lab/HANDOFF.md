# Voxel Lab(복셀 연구소) 뼈대 — 인계 메모

> 2026-10-31 · 리드(1단계 뼈대). PC 재부팅 지시로 경계에서 멈춤(WIP). 설계: `~/.cc-session-viz/design-voxel-lab-20261031/design.md` 대안 A.

## 된 것
- **0단계 갈고리**(커밋 777b6b6, 동작 변화 없음): `VoxelView` 에 `static family` · `_computeLayout` · `_buildRoom` · `_staticSigExtra` · `_drawRoomFacilities` · `_drawRoomDesks` · `_drawMachineAt` · `_makeArtLayer` · `_floorY` · `_frameHook`. `BoxBatch.lift`(캐릭터 바닥 높이), vx-holo 모니터 높이에 `seat.floorY`.
- **등록**: `?view=lab`(별칭 laboratory·voxel-lab·연구소), ⚙ 표현 드롭다운 4번째, `ccviz.view2 = lab`, ctl `view lab`(control-core 값·별칭), i18n(en Voxel Lab / ko 복셀 연구소, 새 영역 `web/i18n/lab.mjs`), 범례 절 `#leg-lab`, 작업 대상 층 연구소만 기본 켬(`ART_DEFAULT_ON`), 2D 는 복셀 오피스 2D + '준비 중' 띠(`renderer2dFor` 의 `base`), POV·quips·plan-ui·ix2d 판정을 family 로.
- **LabView**(`lab-view.js`) + `computeLab`(단일 세션: 브리지 팀장 y1.6·말굽 책상 1～3열·기자재 고리·시설·탕비실 라운지·통신 스크린·ix 자리·지휘 자리) + 길찾기(`nav-core` 가 `room.type 'lab'` 이면 `room.navBoxes`, 경사로로만 브리지 오르내림) + office-core 연구소 분기(ixSpot·breakSpot/Slots·clientScreen/Spot·overseeSpot).
- 시험 `web/test/lab.test.mjs` 13개(등록·i18n·갈고리·결정성·자리 고정·겹침 0·외벽 안·경사로 경로·장애물 비통과·바닥 높이·rigState·성능).

## 확인 안 됨(QA 몫) → 해소(2026-11-01)
- ~~**헤드리스 화면 확인을 한 번도 하지 않음**(규칙상 QA 만). 런타임 오류 가능성 있음 — 특히 상속 모듈(vx-procs·vx-ix `_office`·vx-client `type !== 'office'`·vx-sessions·stencil)이 `type 'lab'` 방에서 그냥 건너뛰는지, 문패 `scene.room.lab`, 2D 대체(Voxel2DView 가 lab 배치 아닌 오피스 배치로 그림 — 의도대로 '준비 중').~~ → QA·통합·리뷰 수리마다 헤드리스 확인(아래 절들, 페이지 오류 0). 2D 는 `Lab2DView` 로 켜짐(`LAB2D_READY` true).
- 확인 URL: `http://localhost:<demo 포트>/?mock=1&view=lab` (다크) · `&theme=light` · `&dim=2d`(준비 중 띠) · `&cam=pov`.

## 남은 일(리드) → 모두 해소(2026-11-01)
- ~~전체 보기(scope=all)는 지금 복셀 오피스 캠퍼스로 그림~~ → 2단계 `lab-campus-core.mjs computeLabCampus`.
- ~~서버: 서버 재시작 전까지 ctl `view lab` 은 bad_value~~ → 운영 7788 서버가 11-01 07:53 개발판으로 다시 떠(`web/control-core.mjs` 마지막 변경 da04804 01:11 뒤) `ctl view lab`·`ctl labwalk` 가 받아짐.
- ~~`bgm-core.mjs VIEWS` 에 lab 별칭 미적용~~ → 2단계에서 `VIEWS` 에 `lab`·`labPoolView`(소리).`git stash@{0}`(음악 초안)은 반영이 끝났지만 지시대로 그대로 둠(pop·drop 금지 — 남은 일 아님).
- ~~CHANGELOG `[Unreleased]`·CONTRACT 새 절·SKILL.md~~ → 2026-11-01 마무리: CHANGELOG Added 줄(이미 있음)·(규격·좌표계·소유권)·SKILL.md(표현 목록·`ctl view lab`).
- ~~2단계 걷기(`FieldPlanner`)를 상태 머신과 잇는 갈고리~~ → 현장 걷기(`_frameHook` → `ch.visit`, character-core `_visitInRoom`)로 연결됨.

## 모듈 규격 진행도(각 파일 머리 주석 = 규격) — 1단계 기록. 2026-11-01 기준 모두 2단계 통합·수리 끝(아래 '상태' 열의 stub·1단계는 그때 값)
| 담당 | 파일 | 상태 |
|---|---|---|
| 리드 | `lab-const.mjs`(공용 상수·좌표계·LAB_PERF·LAB_CAMERA·floorYAt) | 완료(값 변경은 리드) |
| 리드 | `lab-view.js` · `lab-mock.mjs` · `web/i18n/lab.mjs` 리드 절 · 공용 파일(renderers·viewsel·control-core·artifact-core·pov·app·index.html·office.js·props.js·vx-holo·nav-core·office-core·plan-ui·ix2d·flat-view·i18n app/scene/flat) | 1단계 동작 |
| 플랫폼 | `lab-platform-core.mjs`(labSectorPlan·labBlockShape·labPlatformGeometry·labPlatformRadius) · `lab-platform.js`(buildPlatformStatic·LabPlatform3D) | stub(단·코어 정적만) |
| 기자재 | `lab-rig-core.mjs`(RIG_KINDS·RIG_STATES·rigKindOf·rigState·rigGauge·rigSlots·assignRigSlots·RIG_HEX) · `lab-rigs.js`(buildRigRingStatic·drawRig) | 1단계(범용 계측기 + 상태 6색) |
| 캐릭터·책상·지휘석 | `lab-layout-core.mjs`(computeLab·deskRow·rimSlots·labFloorY) · `lab-props.js`(buildLabShell·drawLabFacilities·drawLabDeskEmitters) · `lab-walk-core.mjs`(WALK_RULES·FieldPlanner·rimSpotFor·rigFrontSpot) | 배치·껍데기 1단계, 걷기 stub |
| 평면도(2D) | `web/flat/lab2d.js`(Lab2DView) · `lab2d-platform.js` · `lab2d-rigs.js` · `lab2d-ready.mjs`(LAB2D_READY=false → true 로 켬) | stub |
| 음악·효과음 | `lab-audio.mjs`(LAB_SFX 이름 12·LAB_BGM_FALLBACK·labSoundFor) · 매니페스트 views:lab · sfx.mjs 합성 | stub |
| QA | `web/test/lab.test.mjs`(공유 — 각자 자기 test 블록 추가, 또는 `lab-<역할>.test.mjs` 새 파일) · 헤드리스 확인 | 시험 13 |

i18n `web/i18n/lab.mjs` 는 담당별 절로 나눠 둠 — 자기 절만 편집. 시험은 되도록 `web/test/lab-<역할>.test.mjs` 새 파일(공유 `lab.test.mjs` 충돌 줄이기). 규격 요약·소유권 원문은.

## 시험 메모
- 이번 마무리 때 `npm test` 에서 서버 tqdm 라이브 시험·`artifacts.test.mjs` 도형 시험이 한 번씩 실패했고, 따로 다시 돌리면 통과함(부하 시 시간 민감 — 연구소 변경과 무관). 11-01 리뷰 꼬리 수리들에서는 전체 통과(server 309 · web 977).

## 2단계 통합(2026-11-01, 리드)
- 팀원 모듈을 LabView·Lab2DView 에 연결, 전체 보기 캠퍼스(`lab-campus-core.mjs`), 현장 걷기(⚙ Lab 줄·`ctl labwalk`), 연구소 소리(`Sfx.view`·`playLab`), mock 장면(`?labmock=1..10`).
- 상세는. ~~렌더링 확인은 아직(QA 몫)~~ → QA 수리·화면 재검증에서 확인.

## 가시성· 마무리(2026-11-01, 리드 통합)
- 다섯 과제(플랫폼 연출 M3·M4 · 기자재 M5·팝업 · 보간·케이블·시료 카드·×N 칩·'+n' · 3D 전체 보기 간판/이름표 · 2D 카드·원경 이름표·vx2d-extra)를 묶어 통합. 상세·한계는.
- 통합 때 고친 것: ×N 라벨 클래스 `art-zone`(9.5px) → `art-xn`(호박 알약, `artifacts.css`) · `lab-chip` CSS(`voxel.css`) · 전체 보기 연구동 문패 제거(팀장 이름표와 이름 두 번).
- 헤드리스 확인 완료(M3～M5·2D 카드·캠퍼스·팝업·반지름 보간·'+n'·라이트·복셀 오피스 회귀). '남은 일'은 모두 구현됨.
- ~~남은 것: 2D '+n' 알약이 카드에 가려질 수 있음 · 2D 전체 보기 극원경에서 카드 ↔ 섬 이름표 · 보간 중 시료 카드·이름표는 즉시 이동.~~ → 아래 '남은 한계 6건 수리'(a3dccfb)에서 모두 수리.

## 리뷰 6건 수리(2026-11-01, 3e2763f 뒤)
- 반지름 보간 중 케이블 끝: `_cableInfo().rigAt(id, m)` 가 `_drawMachineAt` 과 같은 보간 자리(rt.m · rt.tw.k)를 주고 `drawLabRigCables` 가 그 자리를 케이블 끝으로 씀.
- 경보 구역 붉은 판: 축 정렬 정사각형 하나 → `alarmPlateTiles`(lab-platform-core, 3줄 × 호 방향 칸, 칸마다 돌아간 칸 안에 드는 축 정렬 정사각형, ≤ 48). 대각선 구역도 코어·바깥 테·이웃 구역 침범 0(시험·헤드리스 확인).
- 2D 경보 캐시 `alarm2D` = 계획별 WeakMap, 장부 항목 캐시 `itemsOf` = 장부 → pid 별 Map(전체 보기에서 연구동마다 매 프레임 다시 만들던 것).
- 할당 0: `cableSegsInto`(조각 버퍼) · `drawLabRigCables` 모듈 버퍼 · `labMarks(…, out)` 표지 객체·정렬 버퍼·주인 목록/보조 선반 캐시 · LabView `_marksOpt`·`_marks`.
- 책상 없는 주인 여럿 '+n': 주인 순서대로 보조 선반 칸을 뒤에서부터 하나씩(칸보다 많으면 0.7m 더 앞).
- 복셀 오피스 회귀: 간판·문패 비킴(`_labelDodgeSigns`) · 원경 셸 이름표 생략(`_farSkipRunLabels`) · 이름표 32칸(`_labelCap`)은 LabView 만 켬. VoxelView 는 24칸·signRects null(b4d9a62 이전과 같음).
- 시험 `web/test/lab-review-fix.test.mjs` 6개.
- ~~남은 것(그대로): 2D '+n' 알약이 카드에 가려질 수 있음 · 2D 극원경 카드 ↔ 섬 이름표 겹침 가능 · 보간 중 시료 카드·이름표는 즉시 이동 · 2D 원경 기준 6px/m 미조정 · 시퀀서 앞 시료 카드 ↔ 경사로 겹침 미확인.~~ → 아래 a3dccfb 에서 모두 수리.

## 남은 한계 6건 수리(2026-11-01, 61ef0a4 뒤 — 통합)
- 2D '+n' 알약: 자리만 방 동적 층(`_planRigMore`), 그리기는 카드 위(`_drawRigMore`, `_drawScene` 끝). 돌린 방이면 ctx 변환으로 화면 좌표. 카드·노드 이름표 장애물 = 정적 글 + 알약 + 섬 이름표(`_syncTextRects`).
- 2D 극원경: 섬 이름표가 카드 장애물. `placeCards` `forceAvoid`(포커스·호버도 다른 방향 → 바깥 칸 → 작게, 다 막히면 원래 슬롯) · `grow` 0.1(섬광 1.1배 몫) · 포커스 상세 이름표도 섬 이름표를 피함(`label-place` `forceRects`) — 모두 연구소 2D 만.
- 원경 이름표 기준 `FAR_LABEL_S` 6 유지(배율 3～8 재어 봄: 6 미만은 연구동 밖으로 삐진 이름표 2～4개, 6 이상 0～1개). 개발자 도구 `__ccviz.view.constructor.FAR_LABEL_S = n`.
- 반지름 보간 중 시료 카드·기자재 이름표·말풍선·초점 대상이 몸체와 같은 `_tweenPos`(헤드리스 13 → 17 → 13, 몸체↔카드 1.05m 유지).
- 시퀀서 시료 카드: 3D 판은 앞 그대로(뒤로 옮기면 시퀀서에 가려짐), 경사로 뒤 시퀀서(k 0·1)는 2D 칩 줄만 몸체 뒤로(`seqCardSpot` → `{d2}`). 2D 판·칩은 연구소만 방위 그대로(`jobFaceExact`).
- 선 열쇠 `artLineKey`(굵기 0～3 으로 묶음, LW 0～3 은 옛 값 그대로).
- 헤드리스 확인 완료(정적 서버 7802, Edge 직렬) · 복셀 오피스 전체 보기 회귀 없음. 상세.
- 남은 것: 없음('한계' 모두 수리). 극원경 섬 이름표끼리 겹침은 아래 리뷰 꼬리 수리에서 연구소 2D 만 거름.

## 리뷰 꼬리 6건 수리(2026-11-01, a3dccfb 뒤)
- 3D 시퀀서 대시보드: office `_holoPass(now, dt)` 갈고리(= `holo.update` 한 곳, 복셀 오피스 동작 같음) → LabView 가 반지름 보간 동안 `_twSwapIn`/`_twSwapOut`(이름표 `_labelPass` 와 같은 m.pos 바꾸기)으로 감쌈. 대시보드 = 몸체 `_tweenPos`(헤드리스: 보간 53프레임 대시보드↔몸체 간격 0, 고치기 전 최대 3.9m).
- 2D 전체 보기 섬 이름표 겹침: `Lab2DView.islandDeclutter`(연구소만) — 바탕 `_placeLabels` 뒤 `_declutterIslands` 가 `declutterIslandSigns`(lab2d-core, 우선순위 = 고른 프로젝트 > live·busy > active > 비활성 아님 > 반지름, 숨겼던 것은 4px 더 떨어져야 다시 보임)로 겹친 낮은 이름표를 `visibility: hidden`. 숨긴 이름표는 카드·라벨 장애물에서 빠지고 `pickLabelAt` 도 건너뜀(공용 pick-core 한 줄 — 다른 표현은 visibility 를 안 씀). 헤드리스: 배율 1.34～0.11 에서 보이는 섬 이름표끼리 겹침 0(끄면 15쌍).
- 2D 모래시계 테두리: `jobFaceExact` 면 카드와 같은 돌린 경로(끄면 strokeRect 그대로). 지역 축 사각형 경로는 모듈 함수 `jobQuadPath`(클로저 없음).
- `seqCardSpot`(이제 export, 시험용): 마지막 수단 (iv)도 `ok` 검사 후보 — 다 막히면 null(jobAnchor 그대로, 칩이 몸체 위로 가지 않음).
- 할당 줄이기: `_drawJob` 의 quad·rd 클로저 없앰 · '+n' 알약 글꼴 문자열은 크기 바뀔 때만(`q.font`) · `_labFar` 는 위치 인자 `labFarAt(s, all)`(`labFarLabel(s, {all, thr})` 그대로).
- 섬 이름표 중복 장애물: `_labelTextRects`(정적 글 + 알약, 섬 빼고)를 flat-view `_obstacleRects` 가 `_canvasTextRects` 대신 씀 — 섬 이름표는 바탕 갈래에서 한 번만(카드용 `_canvasTextRects` 는 섬 포함 그대로).
- 시험 `web/test/lab-review-tail.test.mjs` 6개 + `lab-tween-follow` (7). 헤드리스(정적 서버 7803, Edge 직렬) · 복셀 오피스 2D 전체 보기 회귀 없음.

## 리뷰 꼬리 3건 수리(2026-11-01, 4fbaccb 뒤)
- 3D 초점·가리킴 바닥 고리: office `_machineRing(m, G, p = m.pos)` 갈고리(예전 식 그대로) → LabView 가 연구소 기자재면 `_tweenPos` 자리로. 띄움 점선: LabView `_drawSpawnLinks` 가 보간 동안 `_twSwapIn`/`_twSwapOut` 으로 감쌈(시퀀서 끝 = 몸체 자리).
- 2D 할당: '+n' 알약은 풀 항목에 글꼴·글자·폭을 두고 n·크기가 바뀔 때만 measureText · `_drawJob` 의 `rect` 클로저 → 모듈 함수 `jobRect`(이제 칩마다 클로저 0 — 앞 수리 기록의 '클로저 없음'은 quad·rd 만이었음).
- 시험 `lab-tween-follow` (8) · `lab-review-tail` (6)(7). 헤드리스(정적 서버 7804, Edge 직렬, 반지름 13 → 17 강제): 고리·점선 끝 = 몸체 보간 자리, 연구소 2D·복셀 오피스 3D·2D 오류 0. 상세.

## 리뷰 꼬리 4 수리·남은 한계 정리(2026-11-01, 0ba7d34 뒤 — 61ef0a4..0ba7d34 재리뷰)
- **보간 중 앉은 사람이 자기 책상을 뚫고 지나감**(헤드리스 `labmock=6` 25초: 책상에 앉은 채 책상 상자 안 58프레임, 모두 반지름 보간 중): 책상 등 정적 가구는 새 자리로 바로 옮겨지는데 사람은 옛 반지름 → 새 자리(같은 각)로 미끄러져, 커질 때는 늘 자기 책상을 지났다(크게 바뀌면 기자재도 새 플랫폼·책상을). `_startRadiusTween` 이 `_slideClear`(미끄러질 직선을 0.1m 표본으로 새 배치 `navSolid` — 기자재는 자기 새 상자 반폭 + 0.05 를 뺌)로 막히면 보간하지 않고 가구와 함께 바로(사람은 `snapNext` 순간 이동, 기자재·그 시료 카드는 새 자리). 작게 커지거나(0.5 단위 — 기자재·카드는 미끄러짐) 줄 때(사람은 책상 뒤로)는 그대로 미끄러짐. 헤드리스: 책상 안 0프레임, 반지름 13 → 13.5 보간 61프레임·대상 25.
- **배치가 바뀌어 상자가 선 사람 위에 놓임**(새 기자재가 걷던 사람 자리에 생김·책상이 옮겨 옴 → 상자 안을 0.3～0.7초 걸어 나옴): `_replanBlocked` 가 먼저 책상에 앉지 않은 사람이 새 상자 안이면 `navSpot` 가장 가까운 빈 칸으로 비켜 세운 뒤 남은 길을 검사. 헤드리스: 걷는 사람 상자 안 사건 6 → 1(격자 칸 가장자리 0.1m 안 1회, 상자 밖).
- **`_tweenPos` 반복 계산**: 한 프레임에 몸체·고리·대시보드·점선·이름표·말풍선·초점이 같은 기계에 6～7번 부름 → 같은 프레임(`_now`)·같은 보간(`rt`)·같은 `m.pos` 면 기억한 사본(`m._tqAt`·`m._tqRt`). 헤드리스 보간 61프레임 새로 계산한 값과 차이 0.
- **띄움 점선 바꾸기**: 점선이 없으면(`_spawnIds` 비었음) m.pos 바꾸기 없이 바탕만.
- **2D 프레임마다 강제 레이아웃**: `_islandRects` 가 페이드로 `display: none` 인 섬 이름표를 건너뛰지 않아 폭 0 → 프레임마다 `offsetWidth` 를 다시 읽음 → 건너뜀(장애물도 아님).
- **2D 할당**: `_ownerDesk` 재사용 객체 · `placeCards` 장애물 사각형 사본(`slice(0, 4)`) 없앰(앞 네 값만 읽음, 결과 같음).
- 시험: `lab-tween-follow` (8) 갱신 · (9)(10)(11) 신규, 보간 시험 배치 9 → 10.5(9 → 13 은 이제 바로 옮김 — (10)) · `lab-review-tail` (8) 신규. 헤드리스(정적 서버 7805, Edge 하나 직렬): 연구소 3D·2D(단일·캠퍼스)·복셀 오피스 3D·2D 페이지 오류 0. 상세.
- 문서의 옛 '남은 일·확인 안 됨'(헤드리스 미확인·전체 보기·서버 재시작·bgm 별칭·걷기 갈고리· 눈 확인)은 이미 해소된 것이라 위에서 줄 긋고 해소 위치를 적음.
- **남은 한계: 없음.** (박사님 눈 확인만 남음 — 코드 한계 아님. `stash@{0}` 은 지시대로 보존.)

## 관리자 계단(브리지 경사로) 지그재그 수리(2026-11-01)
- 박사님 지적: "관리자 에이전트(메인/팀장) 계단 오르는 동작이 어색 — 지그재그로 계단을 오르내린다." 원인 두 가지.
  1. **길 모양**: 4방향 격자 A* 꺾은선이 45° 기운 경사로(폭 1.8, 난간 여유 빼면 걸을 띠 ≈1m)를 1m 남짓 가로·세로로 꺾어 오름 — 걸음 방향이 90° 씩 바뀌고 몸이 경사로 폭 안에서 ±0.35m 흔들림. 직선 당김(b4d9a62 `pull`)은 덱·경사로 칸(soft)을 빼서 손대지 않았다. 덱 위도 꺾은선이라 팀장 자리 → 경사로가 덱 뒤 난간까지 돌아감.
  2. **걷기 판단**: 팀장이 책상으로 오르는 중 새 도구(바닥 시설)가 오면 경사로 한가운데서 되돌아 내려감(높이가 오르내림). 배치가 바뀌어 `_replanBlocked` → `ch.replan` 이 목표를 비워도 같은 일.
- 수리(연구소 분기만): `computeLab` 이 `room.navRamps`(경사로 축 — `rampAxis(f, s)`, 발치 0.6m 바깥 ↔ 덱 안 0.6m) → nav-core `nav.ramps`(연구소 격자만) → `route_` 가 격자 길이 경사로를 지나면 `rampRoute` 로 '들어가는 끝까지 격자 길 + 축 직선 + 나가는 끝부터 격자 길'로 다시 짓는다(축 조각이 막히면 예전 길). `lineFree` 는 바닥 칸끼리·비싼 칸끼리만 지나는 직선을 당기고(섞이면 막음), 덱 위만 지나는 길은 칸 가운데 줄로 당김. `character-core._decide` 첫머리에 `ctx.onRamp`(LabView 만 줌) 갈고리 — 경사로 위를 걷는 중이면 목표를 바꾸지 않음. `LabView._replanBlocked` 는 경사로 위 사람을 건너뛰고 `_replanLater` 로 다음 프레임에 다시 봄.
- 시험 `web/test/lab-stair-walk.test.mjs` 4개(구역 1·2·3 팀장 ↔ 바닥 오르내림 높이 단조·경사로 위 축 편차 ≤ 0.05m·경사로 위 한 조각 · 경사로 중간에서 다시 걷기 · 오피스 길 그대로 · `ctx.onRamp` 있으면 경사로 위 되돌기 0, 없으면 재현). `lab.test`·`lab-layout.test` 의 '경사로 중간 높이' 판정은 꼭짓점 → 꼭짓점 + 조각 가운데(경사로가 축 한 조각이 됨).
- 헤드리스(정적 서버 7806, Edge 하나, `?mock=1&view=lab` 90초, 팀장을 바닥 가장자리·문으로 번갈아 보냄): 고치기 전 경사로 위 164프레임에 높이 방향 바뀜 55번·30° 넘게 꺾임 37번·축 편차 최대 0.41m(세 번 중 두 번은 내려가다 되돌아 덱으로) → 고친 뒤 오르내림 5번 모두 높이 단조·꺾임 0·축 편차 0.000m, 페이지 오류 0.
- 남은 한계: 반지름이 바뀌어 브리지가 바깥으로 옮겨 가는 동안 경사로를 걷던 사람은 옛 축을 그대로 걷는다(경사로 띠 안이라 높이는 이어짐, 다 지난 뒤 다시 찾음). 팀장이 도구마다 바닥 시설로 내려가는 동작 자체(잦은 왕복)는 그대로 — 경사로 위에서만 방향을 바꾸지 않음.
