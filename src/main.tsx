import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// PWAのService Workerを登録
// immediate: true は、ページ読み込み後すぐに更新をチェックする設定
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);