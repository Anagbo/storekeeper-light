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
      manifest: {
        id: "/",
        name: "StoreKeeper Light",
        short_name: "StoreKeeper",
        description: "Offline-first sales, expense, inventory, and debt tracking.",
        lang: "en-GH",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f5f7f2",
        theme_color: "#16734a",
        categories: ["business", "finance", "productivity"],
        icons: [
          {
            src: "/icon.svg",
            sizes: "192x192 512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{css,html,ico,js,json,svg,webmanifest}"]
      }
    })
  ],
  build: {
    target: "es2020"
  }
});
