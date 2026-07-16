import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Custom service worker (push + notificationclick land in the web-push ticket).
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
      manifest: {
        name: "IMDb Digital Release Notifier",
        short_name: "Notifier",
        description: "Theatrical and digital release alerts for your IMDb watchlist.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
      },
      // The SW is fully wired (push handlers, install prompt) in a later slice;
      // keep it out of the dev server for now.
      devOptions: { enabled: false, type: "module" },
    }),
  ],
});
