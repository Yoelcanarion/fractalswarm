// The first thing the page loads. `#/` is the home page and loads alone; every other hash belongs to the app shell
// (App.tsx: the run pages, the arena, the charts, with recharts and React Flow), which is a lazy chunk fetched
// on the first visit to one of them, and `#/home-lab` to W7's lab of the visuals, a lazy chunk of its own.
// The home page makes no API call and never touches the run store.

import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { HomePage } from "./HomePage";
import { currentHash, pageOf, type PageName } from "./route";

const AppShell = lazy(() => import("../App").then((module) => ({ default: module.App })));
const Lab = lazy(() => import("./viz/lab/HomeLab").then((module) => ({ default: module.HomeLab })));

export function Root() {
  const [page, setPage] = useState<PageName>(() => pageOf(currentHash()));
  const shown = useRef(page);
  useEffect(() => {
    const onHash = () => {
      const next = pageOf(currentHash());
      if (next === shown.current) return; // from one place of the home page to another, or from one page of the app to another
      shown.current = next;
      window.scrollTo(0, 0); // they are different pages: none starts where another was scrolled to
      setPage(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (page === "home") return <HomePage />;
  return <Suspense fallback={<div className="home-loading" role="status" />}>{page === "lab" ? <Lab /> : <AppShell />}</Suspense>;
}
