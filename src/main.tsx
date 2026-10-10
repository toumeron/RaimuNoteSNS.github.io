import {applyAccentTheme} from './lib/accentTheme';
import { createRoot } from "react-dom/client";
import { registerPwa } from "./lib/registerPwa";
import App from "./App.tsx";
import "./index.css";

applyAccentTheme();
window.addEventListener("storage",event=>{if(event.key==='lime-accent-color'||event.key===null)applyAccentTheme()});
createRoot(document.getElementById("root")!).render(<App />);
registerPwa();
