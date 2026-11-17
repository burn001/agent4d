// Agent4D 배경음악 CDN Worker 설정 (cf CLI 전용, Wrangler 설정 파일 없음)
// R2 버킷 agent4d-music 을 MUSIC 으로 묶어 /bgm/<hash>/<file> 을 공개로 내보낸다. 시크릿·계정 ID 없음.
// 배포: cd cloudflare/music && node ../node_modules/cf/bin/cf deploy   (버킷·곡 올리기는 python music/tracks.py upload)
import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: process.env.AGENT4D_MUSIC_WORKER || "music",
    entrypoint: "./src/music.js",
    compatibilityDate: "2026-10-01",
    workersDev: true,
    previewUrls: false,
    env: {
      MUSIC: bindings.r2({ name: process.env.AGENT4D_MUSIC_BUCKET || "agent4d-music" }),
    },
  },
});
