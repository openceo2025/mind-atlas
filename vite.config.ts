import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";

const https = readHttpsConfig();

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    https,
  },
});

function readHttpsConfig() {
  const keyPath = process.env.MIND_ATLAS_HTTPS_KEY;
  const certPath = process.env.MIND_ATLAS_HTTPS_CERT;
  if (!keyPath || !certPath || !existsSync(keyPath) || !existsSync(certPath)) return undefined;
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}
