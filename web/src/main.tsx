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

const mount = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );

// The static showcase has no server: a shim answers the app's `api/...` calls from files before the app starts.
// Vite folds this test away in every other build, so the shim is not in them (web/src/static/).
if (import.meta.env.MODE === "static") void import("./static/install").then(({ startStatic }) => startStatic(mount));
else mount();
