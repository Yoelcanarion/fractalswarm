// Dark is the default (the video uses it); light is opt-in through <html data-theme="light">.
// The choice is remembered per browser and can be forced with ?theme=light for recordings.

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const KEY = "fractalswarm.theme";
const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function paint(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
}

/** Switches theme without a colour transition smearing across the page: transitions are off
 * while the new tokens resolve and come back after the next paint. */
export function setTheme(theme: Theme): void {
  if (theme === currentTheme()) return;
  const calm = document.createElement("style");
  calm.append(document.createTextNode("*,*::before,*::after{transition:none !important}"));
  document.head.append(calm);
  paint(theme);
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => calm.remove()));
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private window or blocked storage: the theme just does not persist
  }
  listeners.forEach((notify) => notify());
}

/** ?theme=light|dark wins over the remembered choice; neither means dark. */
export function initTheme(): void {
  let wanted: string | null = null;
  try {
    wanted = new URLSearchParams(window.location.search).get("theme") ?? localStorage.getItem(KEY);
  } catch {
    wanted = null;
  }
  paint(wanted === "light" ? "light" : "dark");
}

const subscribe = (notify: () => void): (() => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

export function useTheme(): [Theme, (theme: Theme) => void] {
  return [useSyncExternalStore(subscribe, currentTheme, () => "dark" as Theme), setTheme];
}
