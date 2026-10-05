import { createRoot } from "react-dom/client";
import { registerPwa } from "./lib/registerPwa";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
registerPwa();
