var _a, _b;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var processEnv = (_b = (_a = globalThis.process) === null || _a === void 0 ? void 0 : _a.env) !== null && _b !== void 0 ? _b : {};
var apiPort = processEnv.API_PORT || processEnv.VITE_API_PORT || "3030";
var API_PROXY_TARGET = "http://127.0.0.1:".concat(apiPort);
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
