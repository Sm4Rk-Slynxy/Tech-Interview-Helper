import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Forward /api/* to the local Express proxy (server.js) during development,
// so the Anthropic key stays server-side.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
