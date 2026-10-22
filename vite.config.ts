import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import {createClient} from '@supabase/supabase-js';
import {AnnictCatalog} from './supabase/functions/_shared/animeHistory';
import {createAnimeHistoryHandler} from './supabase/functions/anime-history/handler';
import {existsSync} from 'node:fs';
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  return ({
  define:{'import.meta.env.VITE_RECOMMENDATION_CATALOG_URL':JSON.stringify(env.VITE_RECOMMENDATION_CATALOG_URL||(existsSync('public/recommendations/catalog.json')?'/RaimuNoteSNS.github.io/recommendations/catalog.json':''))},
  // GitHub Pages用のベースパス設定
  base: "/RaimuNoteSNS.github.io/",
  build: { target: ["es2020", "safari16"],rollupOptions:{output:{manualChunks(id){
    // Hashed framework code stays reusable across PWA application updates.
    if(/\/node_modules\/(react\/|react-dom\/|scheduler\/|react-router(?:-dom)?\/|@tanstack\/(?:react-query|query-core)\/)/.test(id))return 'framework';
  }}} },
  worker: { format: 'es' },
  optimizeDeps: { include: ['@huggingface/transformers'] },
  server: {
    host: "127.0.0.1",
    port: 8080,
    proxy: supabaseUrl ? {
      '^/RaimuNoteSNS\\.github\\.io/__lime-link-preview(?:\\?|$)': {
        target: supabaseUrl,
        changeOrigin: true,
        rewrite: requestPath => requestPath.replace('/RaimuNoteSNS.github.io/__lime-link-preview', '/functions/v1/link-preview'),
        configure: proxy => {
          // This server-to-server request retains the user's authorization.
          proxy.on('proxyReq', request => request.removeHeader('origin'));
        },
      },
    } : undefined,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    {
      name: 'lime-anime-history-local-api',
      configureServer(server) {
        const token=loadEnv(mode,path.resolve('supabase'),'ANNICT_').ANNICT_ACCESS_TOKEN;
        const anon=env.VITE_SUPABASE_ANON_KEY;
        const limits=new Map<string,{until:number;count:number}>();
        const client=(request:Request)=>createClient(supabaseUrl!,anon,{global:{headers:{Authorization:request.headers.get('authorization')??''}},auth:{persistSession:false,autoRefreshToken:false}});
        const handler=createAnimeHistoryHandler({
          catalog:new AnnictCatalog(token??''),client,
          authenticate:async(request,readOnly)=>{
            const auth=request.headers.get('authorization')??'';
            if(!/^Bearer \S+$/i.test(auth))return Response.json({error:'ログインしてください'},{status:401});
            const db=client(request),{data,error}=await db.auth.getUser(auth.slice(7));
            if(error||!data.user)return Response.json({error:'ログインしてください'},{status:401});
            if(!readOnly){const check=await db.rpc('is_account_suspended',{account_id:data.user.id});if(check.error)return Response.json({error:'アカウントの状態を確認できません'},{status:503});if(check.data)return Response.json({error:'凍結中は視聴履歴を変更できません'},{status:403});}
            return {userId:data.user.id};
          },
          limit:async actor=>{
            if(limits.size>1000)limits.clear();let value=limits.get(actor);if(!value||value.until<Date.now()){value={until:Date.now()+300000,count:0};limits.set(actor,value);}return ++value.count>100?Response.json({error:'時間をおいて再試行してください'},{status:429}):null;
          },
        });
        server.middlewares.use('/RaimuNoteSNS.github.io/__lime-anime-history',async(req,res)=>{
          try{const chunks:Buffer[]=[];let size=0;for await(const part of req){const chunk=Buffer.from(part);size+=chunk.length;if(size>262144){res.statusCode=413;res.end();return;}chunks.push(chunk);}
            const request=new Request('http://localhost/__lime-anime-history',{method:req.method,headers:{authorization:String(req.headers.authorization??''),'content-type':'application/json'},...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
            const response=await handler(request);res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.end(await response.text());
          }catch{res.statusCode=502;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Annictとの接続を確認できませんでした'}));}
        });
      },
    },
    react(),
    {name:'recommendation-catalog-dev-ready',configureServer(server){
      const catalog=path.resolve('public/recommendations/catalog.json');
      if(existsSync(catalog))return;
      server.watcher.add(path.dirname(catalog));
      const ready=(file:string)=>{if(path.resolve(file)!==catalog)return;server.watcher.off('add',ready);void server.restart();};
      server.watcher.on('add',ready);
    }},
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg", "push-sw.js", "pwa-update-sw.js"],
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
          "decoders/**", "assets/LimeMap-*", "assets/LimeMaps-*", "assets/DirectMessages-*", "assets/hls-*", "assets/AgoraRTC*", "assets/pdfjs*", "assets/three*",
          "assets/*Loader-*", "assets/draco*", "assets/meshopt*",
          "assets/mmdAvatar-*", "assets/avatarRuntime-*", "assets/AvatarStage-*",
          "assets/spaceMusicScore-*", "assets/ChatPage-*", "assets/Settings-*", "assets/MediaViewer-*",
          "assets/PostDetail-*", "assets/Profile-*",
          "assets/localGemma.worker-*", "assets/recommendationVisual.worker-*", "assets/recommendationVisualInference-*", "assets/transformers*", "assets/ort-*",
          "assets/SearchPage-*", "assets/PostActivity-*", "assets/Share-*", "assets/Notifications-*",
          "assets/FollowersFollowingPage-*", "assets/SpacePage-*", "assets/NewsPage-*",
          "assets/terms-*", "assets/LimePro-*", "assets/NotFound-*",
        ],
        runtimeCaching: [{
          urlPattern: ({ url, sameOrigin }) => sameOrigin &&
            /\/RaimuNoteSNS\.github\.io\/(assets|decoders)\/.*\.(js|css|wasm|gz)$/.test(url.pathname),
          handler: "CacheFirst",
          options: {
            cacheName: "lime-feature-assets-v1",
            expiration: { maxEntries: 48, maxAgeSeconds: 30 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [200] },
          },
        }],
        navigateFallback: "/RaimuNoteSNS.github.io/index.html",
        importScripts: ["push-sw.js", "pwa-update-sw.js"],
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
  });
});
