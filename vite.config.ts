import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const apiPort = processEnv.API_PORT || processEnv.VITE_API_PORT || "3030";
const API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3024,
    proxy: {
      "/api": {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        secure: false,
        ws: false
      }
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 3025
  }
});
