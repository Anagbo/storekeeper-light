import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{css,html,ico,js,json,png,svg,webmanifest,woff,woff2}"]
      }
    })
  ],
  build: {
    target: "es2020"
  }
});
