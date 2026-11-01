import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  base: process.env.APP_BASE || "/",
  build: {
    target: "es2022",
    rollupOptions: { input: { app: "index.html", proof: "engine-proof.html" } },
  },
});
