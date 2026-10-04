import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Let the initial page finish loading before installing/updating the offline cache.
registerSW({ onRegisterError: (error) => console.warn('PWA registration failed', error) });

createRoot(document.getElementById("root")!).render(<App />);