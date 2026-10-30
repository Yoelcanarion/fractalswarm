// A standalone entry for the lab: `npm run dev`, then open /src/home/viz/lab/index.html. The same
// HomeLab renders at `#/home-lab` once the app routes to it (see viz/index.ts).

import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../../../styles/tokens.css";
import "../../../styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initTheme } from "../../../lib/theme";
import { HomeLab } from "./HomeLab";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HomeLab />
  </StrictMode>,
);
