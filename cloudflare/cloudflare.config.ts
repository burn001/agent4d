// cc-agent-viz Worker 설정 (cf CLI 전용, Wrangler 설정 파일 없음)
// KV 네임스페이스 ID 는 레포에 넣지 않고 배포 시 환경변수 CCVIZ_KV_ID 로 주입한다
// (bin/ccviz.mjs deploy 가 <상태 폴더>/config.json 의 kvNamespaceId 를 넘김).
import { bindings, defineConfig } from "cf/config";

const kvId = process.env.CCVIZ_KV_ID;
if (!kvId) throw new Error("CCVIZ_KV_ID 환경변수가 필요합니다 (node bin/ccviz.mjs deploy 로 실행하십시오)");

export default defineConfig({
  worker: {
    name: process.env.CCVIZ_WORKER_NAME || "cc-agent-viz",
    entrypoint: "./src/worker.js",
    compatibilityDate: "2026-10-01",
    workersDev: true,
    previewUrls: false,
    env: {
      CCVIZ: bindings.kv({ id: kvId }),
      VIEW_TOKEN: bindings.secret(),
      ADMIN_SECRET: bindings.secret(),
    },
  },
});
