// cf build/deploy 가 위임하는 Vite 빌드 설정 (Worker 번들만, 정적 자산 없음)
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
});
