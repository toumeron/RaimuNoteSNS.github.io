import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  // GitHub Pages のリポジトリ名を指定
  base: '/RaimuNoteSNS.github.io/', 
  plugins: [react()],
  test: {
    environment: "jsdom",
    env: { BASE_URL: "/RaimuNoteSNS.github.io/" },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
