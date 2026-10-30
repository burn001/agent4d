# music — 배경음악 결정적 합성

`compose.py` 하나로 `web/assets/bgm.mp3`(44.1kHz 스테레오, 128kbps CBR, 300초)와 `web/assets/bgm.json`을 만듭니다.
외부 샘플 없이 numpy로 전부 합성하므로 저작권 문제가 없습니다. 시드 2026 고정이라 다시 돌려도 MP3 해시가 같습니다.

## 재생성

```
python -m pip install -r music/requirements.txt   # numpy, lameenc==1.9.0
python music/compose.py                            # 기본 출력 web/assets/bgm.mp3
python music/compose.py --wav 미리듣기.wav          # WAV 사본도(레포에 커밋하지 않음)
```

`make_bgm.py`는 같은 동작의 별칭입니다. 실행 시간은 약 1분 40초, 메모리는 약 1.5GB를 씁니다.
실행이 끝나면 구간별 RMS·피크·LUFS 표, 15초 창 RMS 곡선, 루프 이음매 수치, MP3 길이·크기·해시를 출력하고,
길이 300±0.5초·8MB 이하를 검사해 통과하지 못하면 종료 코드 1을 돌려줍니다.

## 곡 구조 (96 BPM, 4/4, 120마디, D minor)

| 구간 | 시간 | 마디 | 내용 |
|---|---|---|---|
| 기 | 0:00～1:15 | 0～29 | 저음 드론, 디튠 톱니파 패드(필터 닫힘), 성긴 FM 벨, 12마디부터 잔잔한 8분 아르페지오, 비트 없음 |
| 승 | 1:15～2:30 | 30～59 | 소프트 킥(32마디 반박 → 38마디 4분), 스윙 브러시 하이햇, 36마디 베이스, 사이드체인 덕킹, 57～59마디 노이즈 상승 |
| 전 | 2:30～3:45 | 60～89 | 화성 전환 Gm9–Ebmaj7#11–Bbmaj9–A7, 멜로디 모티프 4프레이즈(76마디부터 옥타브 벨 겹침), 16분 아르페지오, 림 2·4박, 필터 최대(78마디) |
| 결 | 3:45～5:00 | 90～119 | 비트·베이스 빠짐, 모티프를 벨로 회상(98마디), Dm9 패드로 귀결, 페이드아웃 |

- 기·승 화성: Dm9–Bbmaj9–Fmaj7–C6/9 (2마디씩)
- 이펙트: 다중 탭 초기 반사 + 2대역 감쇠 꼬리의 합성 IR 리버브, 3/8박 핑퐁 딜레이, 킥 트리거 사이드체인
- 마스터: BS.1770 K 가중 게이트 라우드니스 근사로 −16 LUFS, 룩어헤드 리미터 샘플 피크 −1.5 dBFS, TPDF 디더

## 루프

곡 전체를 길이 정확히 300초의 원형 버퍼에 합성합니다. 끝을 넘는 음 꼬리·리버브·딜레이는 앞머리로 감기고,
드론 주파수와 LFO 주기는 300초에 정수 주기로 맞췄습니다. 처음과 끝은 같은 Dm9 패드·드론, 같은 마스터 레벨(0.22)이라
`<audio loop>`로 재생해도 이음매가 끊기지 않습니다. MP3 인코더 지연(약 25ms)은 남으므로 완전한 무간격은 아닙니다.

## 곡 목록

웹 상단 바의 곡 선택기(자동 + 단계별 곡 묶음 + 순환·무작위)는`web/assets/bgm-tracks.json` 매니페스트를 읽습니다.
매니페스트가 곡 목록의 원본입니다 — 곡마다 `stage`(자동 선곡 단계 0 한가 · 1 보통 · 2 활발 · 3 매우 활발, 여러 단계 겸용이면 배열)와
`energy`(0～1, 같은 단계 안 순서·단계가 없을 때 `round(energy×3)`)를 둡니다. 자동은 지금 활동 단계의 곡 중 직전 2곡을 피해 무작위로 고릅니다.

| id | 선택기 | 제목 | 합성 스크립트 | 파일 | BPM · 조 | 원곡 |
|---|---|---|---|---|---|---|
| ambient | 앰비언트 | 앰비언트 | `compose.py` | `bgm.mp3`·`bgm.json` | 96 · D minor | 자체 작곡 |
| lofi | 로파이 | 깊은 작업 | `compose_lofi.py` | `bgm-lofi.mp3`·`.json` | 84 · D dorian | 이전 프로젝트 `music.js` deep |
| jazz | 재즈 | 모퉁이 카페 (5분 편곡) | `compose_jazz.py` | `bgm-jazz.mp3`·`.json` | 96 · Bb major | 이전 프로젝트 `music.js` cafe |
| city | 작은 도시 | 작은 도시 | `compose_city.py` | `bgm-city.mp3`·`.json` | 104 · G major | 이전 프로젝트 `music.js` city |
| chillhop | 칠홉 | Slow Pour | `compose_chillhop.py` | `bgm-chillhop.mp3`·`.json` | 80 · F major | 자체 작곡 |
| pulse | 어두운 펄스 | 심야 컴파일 | `compose_pulse.py` | `bgm-pulse.mp3`·`.json` | 100 · C minor | 자체 작곡 |
| circuit | 회로 펄스 | 회로 기판 | `compose_circuit.py` | `bgm-circuit.mp3`·`.json` | 116 · E minor | 자체 작곡 |
| overclock | 오버클록 | 오버클록 | `compose_overclock.py` | `bgm-overclock.mp3`·`.json` | 140 · G minor | 자체 작곡 |
| stardust | 별빛 항로 | 별빛 항로 | `compose_stardust.py` | `bgm-stardust.mp3`·`.json` | 72 · E lydian | 자체 작곡 |
| nebula | 성운 맥동 | 성운 맥동 | `compose_nebula.py` | `bgm-nebula.mp3`·`.json` | 80 · C dorian | 자체 작곡 |
| pulsar | 펄서 시퀀스 | 펄서 시퀀스 | `compose_pulsar.py` | `bgm-pulsar.mp3`·`.json` | 112 · A minor | 자체 작곡 |
| warp | 워프 항해 | 워프 항해 | `compose_warp.py` | `bgm-warp.mp3`·`.json` | 128 · D minor | 자체 작곡 |
| bossa | 아침 보사노바 | 아침 카페 보사노바 | `compose_bossa.py` | `bgm-bossa.mp3`·`.json` | 116 · D major | 자체 작곡 |
| swing | 점심 빅밴드 | 점심시간 빅밴드 | `compose_swing.py` | `bgm-swing.mp3`·`.json` | 192 · F major | 자체 작곡 |
| caper | 오피스 소동 | 오피스 소동 | `compose_caper.py` | `bgm-caper.mp3`·`.json` | 160 · C major (추격 구간 A minor) | 자체 작곡 |

| glacier | 빙하 위의 코드 | 빙하 위의 코드 | `compose_glacier.py` | `bgm-glacier.mp3`·`.json` | 68 · B minor | 자체 작곡 |
| cursor | 깜빡이는 커서 | 깜빡이는 커서 | `compose_cursor.py` | `bgm-cursor.mp3`·`.json` | 76 · F# minor | 자체 작곡 |
| refactor | 리팩터 루프 | 리팩터 루프 | `compose_refactor.py` | `bgm-refactor.mp3`·`.json` | 88 · G# minor | 자체 작곡 |
| queue | 빌드 대기열 | 빌드 대기열 | `compose_queue.py` | `bgm-queue.mp3`·`.json` | 105 (3/4) · Bb minor | 자체 작곡 |
| stack | 스택 트레이스 | 스택 트레이스 | `compose_stack.py` | `bgm-stack.mp3`·`.json` | 124 · C# minor | 자체 작곡 |
| sprint | 스프린트 | 스프린트 | `compose_sprint.py` | `bgm-sprint.mp3`·`.json` | 132 · Eb minor | 자체 작곡 |
| hotfix | 핫픽스 | 핫픽스 | `compose_hotfix.py` | `bgm-hotfix.mp3`·`.json` | 148 · D phrygian | 자체 작곡 |
| deadline | 마감 질주 | 마감 질주 | `compose_deadline.py` | `bgm-deadline.mp3`·`.json` | 156 · Bb major | 자체 작곡 |
| aurora | 오로라 장막 | 오로라 장막 | `compose_aurora.py` | `bgm-aurora.mp3`·`.json` | 52 · Ab major | 자체 작곡 |
| deepfield | 심우주 관측 | 심우주 관측 | `compose_deepfield.py` | `bgm-deepfield.mp3`·`.json` | 66 (3/4) · C# minor | 자체 작곡 |
| comet | 혜성 꼬리 | 혜성 꼬리 | `compose_comet.py` | `bgm-comet.mp3`·`.json` | 92 · Bb lydian | 자체 작곡 |
| satellite | 위성 교신 | 위성 교신 | `compose_satellite.py` | `bgm-satellite.mp3`·`.json` | 100 · G mixolydian | 자체 작곡 |
| ionstorm | 이온 폭풍 | 이온 폭풍 | `compose_ionstorm.py` | `bgm-ionstorm.mp3`·`.json` | 120 · F minor | 자체 작곡 |
| gravity | 중력 선회 | 중력 선회 | `compose_gravity.py` | `bgm-gravity.mp3`·`.json` | 124 · Eb major | 자체 작곡 |
| supernova | 초신성 | 초신성 | `compose_supernova.py` | `bgm-supernova.mp3`·`.json` | 136 · F# minor | 자체 작곡 |
| hyperspace | 초공간 질주 | 초공간 질주 | `compose_hyperspace.py` | `bgm-hyperspace.mp3`·`.json` | 144 · B minor | 자체 작곡 |
| rainwindow | 창가의 비 | 창가의 비 | `compose_rainwindow.py` | `bgm-rainwindow.mp3`·`.json` | 56 · Eb major | 자체 작곡 |
| teatime | 오후의 찻잔 | 오후의 찻잔 | `compose_teatime.py` | `bgm-teatime.mp3`·`.json` | 84 (3/4) · A major | 자체 작곡 |
| typewriter | 타자기 산책 | 타자기 산책 | `compose_typewriter.py` | `bgm-typewriter.mp3`·`.json` | 108 · Ab major | 자체 작곡 |
| espresso | 에스프레소 한 잔 | 에스프레소 한 잔 | `compose_espresso.py` | `bgm-espresso.mp3`·`.json` | 88 · G minor | 자체 작곡 |
| meeting | 회의실 스카 | 회의실 스카 | `compose_meeting.py` | `bgm-meeting.mp3`·`.json` | 152 · E major | 자체 작곡 |
| copier | 복사기 디스코 | 복사기 디스코 | `compose_copier.py` | `bgm-copier.mp3`·`.json` | 124 · Db major | 자체 작곡 |
| pantry | 탕비실 대소동 | 탕비실 대소동 | `compose_pantry.py` | `bgm-pantry.mp3`·`.json` | 176 · D harmonic minor | 자체 작곡 |
| mambo | 금요일 맘보 | 금요일 맘보 | `compose_mambo.py` | `bgm-mambo.mp3`·`.json` | 184 · C minor | 자체 작곡 |

표에 없는 곡(dawn·orbit·drive·deephouse·funk·liquid·uplift)은 매니페스트 참고. 새 10곡(pulse～caper, 2026-10-28)은 표현별 세 에이전트가 만든 곡이고,
glacier～mambo 24곡(2026-10-30)은 표현 × 단계마다 2곡씩 더한 곡입니다(지금 46곡). 3/4 곡(queue·deepfield·teatime)은 매니페스트에 `beats: 3` 이 있어
자동 단계 전환 크로스페이드가 실제 마디 경계에 맞춥니다.

**테마별 풀**: 곡마다`views`(표현별 단계)를 두고, 자동 선곡은 지금 보고 있는 표현의 풀에서만 고릅니다(그 단계에 곡이 없으면 `stage` 전체 풀로 폴백).

| 표현 | 0 한가 | 1 보통 | 2 활발 | 3 매우 활발 |
|---|---|---|---|---|
| flow (Intense 코딩) | lofi·pulse·glacier·cursor | lofi·deephouse·circuit·refactor·queue | drive·deephouse·stack·sprint | liquid·uplift·overclock·hotfix·deadline |
| planet (Cosmic Ambient) | orbit·ambient·aurora·deepfield | stardust·nebula·comet·satellite | drive·pulsar·ionstorm·gravity | uplift·warp·supernova·hyperspace |
| voxel (카페·사무실) | dawn·bossa·rainwindow·teatime | jazz·chillhop·lofi·typewriter·espresso | city·funk·meeting·copier | swing·caper·pantry·mambo |

### 공용 엔진 `bgmkit.py` (2026-10-30 24곡)

glacier～mambo 24곡의 `compose_<id>.py` 는 곡마다 설정·편곡(`setup(...)`·`build()`)만 두고 합성은 `music/bgmkit.py` 를 씁니다
(Planet 묶음의 층·섹션 곡선·사이드체인·에코·리버브·마스터링 + 복셀 묶음의 화음 파서·보이싱·가산 악기·드럼을 한 모듈로).
4/4 외에 `beats=3`(3/4)도 되고, 마디 수 × 박 × 60/BPM 이 정확히 300초가 아니면 시작하지 않습니다. 곡 하나에 약 3분, 메모리 약 2GB.

```
python music/compose_glacier.py --out <임시폴더>/bgm-glacier.mp3      # mp3·json·report-glacier.json
python music/tracks.py copy glacier --from <임시폴더> --stage 0 --energy 0.18 --views "flow:0" --label "빙하 위의 코드"     --label-en "Code on Ice" --title-en "Code on Ice" --mood-en "…"
```

`report-<id>.json` 에 LUFS·샘플 피크·클리핑 샘플 수·루프 이음매(마지막↔처음 샘플 차와 그 근처 보통 최대 차)·15초 창 RMS·스펙트럼 중심이 남고,
−16±0.5 LUFS·피크 −1.5 dBFS 이하·클리핑 0·이음매 차 ≤ max(3×보통 차, 0.02)·300±0.5초·128kbps CBR 을 못 넘으면 종료 코드 1 입니다.

`python music/tracks.py copy <id> --from <폴더> --stage 1 --energy 0.4 --views "flow:0,1;voxel:1" [--key-en "…"]` 로 넣거나, 이미 있는 곡은 매니페스트 `views` 를 고친 뒤 `manifest` 를 돌립니다.

원곡 출처: 작성자의 이전 프로젝트 `music.js` 의 deep·cafe·city 곡(화음 진행·동기·리듬 규칙)을 numpy 결정적 합성
5분 편곡으로 옮겼습니다. 모두 300초, 128kbps CBR, −16 LUFS, 처음과 끝이 이어지는 루프입니다. 외부 샘플은 쓰지 않습니다.

### 새 곡 재생성

세 스크립트는 MP3 와 같은 폴더에 json·`report.md`·`spectrogram.png` 를 함께 쓰므로, 임시 폴더로 낸 뒤 `tracks.py copy` 로 레포에 넣습니다
(report·png 는 복사하지 않음). 실행에 각 3～4분이 걸립니다.

```
python music/compose_lofi.py --out <임시폴더>/bgm-lofi.mp3
python music/compose_jazz.py --out <임시폴더>/bgm-jazz.mp3
python music/compose_city.py --out <임시폴더>/bgm-city.mp3
python music/tracks.py copy lofi --from <임시폴더>     # compose_lofi.py → music/, mp3·json → web/assets/, 매니페스트 갱신
```

### 다른 곳에서 만든 곡을 다시 복사

```
python music/tracks.py copy jazz --from <compose_jazz.py·bgm-jazz.mp3·bgm-jazz.json 이 있는 폴더>
python music/tracks.py manifest                         # 매니페스트만 다시 쓰기
```

### 새 곡 추가 (단계·energy 함께)

1. 합성 결과를 한 폴더에 `compose_<id>.py`·`bgm-<id>.mp3`·`bgm-<id>.json`(메타: duration·bpm·key·sections·title·mood) 이름으로 둡니다(300초·128kbps·−16 LUFS·루프 권장).
2. 복사 + 매니페스트 등록:
   ```
   python music/tracks.py copy <id> --from <폴더> --stage 2 --energy 0.65 --label 짧은이름 --source "출처"
   python music/tracks.py copy <id> --from <폴더> --stage 2,3 --energy 0.8 --label …   # 여러 단계 겸용
   ```
   새 곡은 `--stage` 또는 `--energy` 가 꼭 필요합니다(`--stage` 를 빼면 `round(energy×3)` 단계). 이미 있는 곡을 다시 copy 하면 준 옵션만 바뀝니다.
3. 이미 있는 곡의 단계를 바꾸려면(예: 새 곡이 와서 작은 도시를 활발 전용으로) `web/assets/bgm-tracks.json` 의 `stage`·`energy` 를 고친 뒤 `manifest` 를 돌립니다(메타 json 값만 다시 반영, 단계는 그대로 둠).
4. 목록에서 빼기: `python music/tracks.py remove <id>`(파일은 지우지 않음).
5. `npm test`(bgm·bgm-auto 시험이 다섯 곡 이상·stage·energy 를 검사).
