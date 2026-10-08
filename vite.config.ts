import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages用のベースパス設定
  base: "/RaimuNoteSNS.github.io/",
  build: { target: ["es2020", "safari16"] },
  server: {
    host: "127.0.0.1",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg", "push-sw.js"],
      manifest: {
        name: "LimeNote SNS",
        short_name: "LimeNote",
        description: "A next-generation SNS built with Supabase and Vite",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        scope: "/RaimuNoteSNS.github.io/",
        start_url: "/RaimuNoteSNS.github.io/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ],
        // 他のアプリの共有メニューに表示させるための設定
        share_target: {
          action: "/RaimuNoteSNS.github.io/share",
          method: "GET",
          // ブラウザの警告（Enctype）を解消するために追加
          enctype: "application/x-www-form-urlencoded",
          params: {
            title: "title",
            text: "text",
            url: "url"
          }
        },
        screenshots: [
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            form_factor: "wide",
            label: "Desktop View"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            form_factor: "narrow",
            label: "Mobile View"
          }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        // Audio, document and 3D engines are cached only when the feature is opened.
        // Do not download them all during installation on an iOS home-screen launch.
        globIgnores: [
          "decoders/**", "assets/AgoraRTC*", "assets/pdfjs*", "assets/three*",
          "assets/*Loader-*", "assets/draco*", "assets/meshopt*",
          "assets/mmdAvatar-*", "assets/avatarRuntime-*",
          "assets/spaceMusicScore-*", "assets/ChatPage-*", "assets/Settings-*", "assets/MediaViewer-*",
          "assets/PostDetail-*", "assets/Profile-*",
          "assets/SearchPage-*", "assets/PostActivity-*", "assets/Share-*", "assets/Notifications-*",
          "assets/FollowersFollowingPage-*", "assets/SpacePage-*", "assets/NewsPage-*",
          "assets/terms-*", "assets/LimePro-*", "assets/NotFound-*",
        ],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.origin === self.location.origin &&
            /\/RaimuNoteSNS\.github\.io\/(assets|decoders)\/.*\.(js|css|wasm)$/.test(url.pathname),
          handler: "CacheFirst",
          options: {
            cacheName: "lime-feature-assets-v1",
            expiration: { maxEntries: 48, maxAgeSeconds: 30 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [200] },
          },
        }],
        navigateFallback: "/RaimuNoteSNS.github.io/index.html",
        importScripts: ["push-sw.js"],
        // ビルドエラー回避のためキャッシュ許容サイズを5MBに拡大
        maximumFileSizeToCacheInBytes: 5242880,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
}));
