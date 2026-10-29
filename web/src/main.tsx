import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@xyflow/react/dist/style.css";
import "./styles/tokens.css";
import "./styles.css";
import "./styles/ui.css";
import "./styles/lens.css";
import "./styles/lite.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { initLite } from "./lib/lite";
import { startFrameLogger } from "./lib/perf";
import { initTheme } from "./lib/theme";

initTheme();
initLite();
startFrameLogger();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
