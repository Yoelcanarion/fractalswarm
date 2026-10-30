// The first thing the page loads. `#/` is the home page and loads alone; every other hash belongs to the app shell
// (App.tsx: the run pages, the arena, the charts, with recharts and React Flow), which is a lazy chunk fetched
// on the first visit to one of them. The home page makes no API call and never touches the run store.

import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { HomePage } from "./HomePage";
import { currentHash, isHomeHash } from "./route";

const AppShell = lazy(() => import("../App").then((module) => ({ default: module.App })));

export function Root() {
  const [home, setHome] = useState(() => isHomeHash(currentHash()));
  const shown = useRef(home);
  useEffect(() => {
    const onHash = () => {
      const next = isHomeHash(currentHash());
      if (next === shown.current) return; // from one place of the home page to another, or from one page of the app to another
      shown.current = next;
      window.scrollTo(0, 0); // the two are different pages: neither starts where the other was scrolled to
      setHome(next);
    };
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
