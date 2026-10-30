// The first thing the page loads. `#/` is the home page and loads alone; every other hash belongs to the app shell
// (App.tsx: the run pages, the arena, the charts, with recharts and React Flow), which is a lazy chunk fetched
// on the first visit to one of them. The home page makes no API call and never touches the run store.

import { lazy, Suspense, useEffect, useState } from "react";

import { HomePage } from "./HomePage";
import { currentHash, isHomeHash } from "./route";

const AppShell = lazy(() => import("../App").then((module) => ({ default: module.App })));

export function Root() {
  const [home, setHome] = useState(() => isHomeHash(currentHash()));
  useEffect(() => {
    const onHash = () => setHome(isHomeHash(currentHash()));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (home) return <HomePage />;
  return (
    <Suspense fallback={<div className="home-loading" role="status" />}>
      <AppShell />
    </Suspense>
  );
}
