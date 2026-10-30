import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Root } from "./home/Root";
import { initLite } from "./lib/lite";
import { startFrameLogger } from "./lib/perf";
import { initTheme } from "./lib/theme";

initTheme();
initLite();
startFrameLogger();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
