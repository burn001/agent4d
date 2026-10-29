// `node --test server/test` (Node 24 는 폴더 인자를 모듈로 해석) 를 위한 진입점
import './unit.test.mjs';
import './runtime.test.mjs';
import './http.test.mjs';
import './replay.test.mjs';
import './projects.test.mjs';
import './overview.test.mjs';
import './limits.test.mjs';
import './statusline.test.mjs';
import './match.test.mjs';
import './replay-idle.test.mjs';
import './ccviz-cli.test.mjs';
import './stopped.test.mjs';
import './brief.test.mjs';
import './ctx.test.mjs';
import './sessions-sort.test.mjs';
import './launcher.test.mjs';
import './panel.test.mjs';
import './archive.test.mjs';
import './archive-cli.test.mjs';
import './runner.test.mjs';
import './archive-extras.test.mjs';
import './multi.test.mjs';
import './shell-targets.test.mjs';
import './interactions.test.mjs';
import './succession.test.mjs';
import './artifacts.test.mjs';
import './plans.test.mjs';
import './version.test.mjs';
import './update.test.mjs';
import './procs.test.mjs';
import './jobs.test.mjs'; // (목록에서 빠져 있던 것)
import './home.test.mjs';
import './control.test.mjs'; // 화면 원격 조작
import './longrun.test.mjs';
import './sse-out.test.mjs'; // 이벤트 몰림 조절
import './extjobs.test.mjs'; // 외부 작업 등록부
import './clear-head.test.mjs';
import './auto-turn.test.mjs';
import './plan-format.test.mjs';
import './loop-axes.test.mjs';
