import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// マインドアトラス（カード）。既存 src/ とは別の Vite ルートで、ビルド成果物は dist-spatial/ に出す。
// 環境変数はリポジトリ直下の .env を読む。公開ビルドは /card/ の下で配信する：
// mind-atlas.org では宇宙の中に埋め込まれ、card.mind-atlas.org でも同じパスで単独に開く。
const root = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ command }) => ({
  root,
  base: command === "build" ? "/card/" : "/",
  envDir: repoRoot,
  publicDir: "public",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist-spatial", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    https: readHttpsConfig(),
  },
}));

function readHttpsConfig() {
  const keyPath = process.env.MIND_ATLAS_HTTPS_KEY;
  const certPath = process.env.MIND_ATLAS_HTTPS_CERT;
  if (!keyPath || !certPath || !existsSync(keyPath) || !existsSync(certPath)) return undefined;
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}
