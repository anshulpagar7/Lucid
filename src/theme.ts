// Themes. One table drives both the CSS tokens (Tailwind's --color-* / --font-*
// variables) and the INK object that canvas and chart code read, so a theme
// change repaints everything: DOM, SVG, canvas and uPlot.

import { flushSync } from "react-dom";
import { create } from "zustand";

export type ThemeId = "paper" | "night" | "crimson" | "storm" | "ember" | "speedway";

type Palette = {
  paper: string; // page background
  card: string; // panels
  sunk: string; // recessed surfaces
  line: string;
  line2: string;
  grid: string; // chart gridlines
  fg: string;
  muted: string;
  faint: string;
  accent: string; // primary buttons, active nav
  accentFg: string;
  att: string;
  eng: string;
  load: string;
  pulse: string;
  ok: string;
  bad: string;
  screen: string; // camera viewfinder
  screen2: string;
};

export type Theme = {
  id: ThemeId;
  name: string;
  blurb: string;
  dark: boolean;
  display: string; // heading typeface stack
  ink: Palette;
};

const PAPER: Palette = {
  paper: "#f5f0e6", card: "#fcfaf5", sunk: "#f1ebdf", line: "#e5ddcd", line2: "#d3c7b2", grid: "#ece5d6",
  fg: "#1e1b16", muted: "#6a6155", faint: "#9c9282", accent: "#1e1b16", accentFg: "#fcfaf5",
  att: "#0083a3", eng: "#5a45b0", load: "#b5730a", pulse: "#c23a4f", ok: "#2f7d4f", bad: "#b42318",
  screen: "#191714", screen2: "#24211c",
};

export const THEMES: Theme[] = [
  { id: "paper", name: "Paper", blurb: "Cream paper and ink", dark: false, display: '"Newsreader Variable", "Newsreader", Georgia, serif', ink: PAPER },
  {
    id: "night", name: "Nightwatch", blurb: "Midnight, with a searchlight", dark: true, display: '"Oswald", "Arial Narrow", sans-serif',
    ink: {
      paper: "#0f1013", card: "#16181c", sunk: "#1c1f24", line: "#272a31", line2: "#383c45", grid: "#1f2228",
      fg: "#ecebe6", muted: "#a2a5ac", faint: "#6c7079", accent: "#f2c230", accentFg: "#121212",
      att: "#4cc3e6", eng: "#a592ff", load: "#f2b134", pulse: "#ff6b7f", ok: "#5ad18f", bad: "#ff6060",
      screen: "#08090b", screen2: "#121418",
    },
  },
  {
    id: "crimson", name: "Crimson", blurb: "Navy and red, comic halftone", dark: true, display: '"Barlow Condensed", "Arial Narrow", sans-serif',
    ink: {
      paper: "#0c1430", card: "#121c3c", sunk: "#182447", line: "#24325d", line2: "#33447a", grid: "#1a254b",
      fg: "#f3f1f5", muted: "#aab3cc", faint: "#7380a3", accent: "#e8333a", accentFg: "#ffffff",
      att: "#5fc6ff", eng: "#b59dff", load: "#ffb340", pulse: "#ff5d72", ok: "#4fd49a", bad: "#ff5a5a",
      screen: "#070c1e", screen2: "#0f1730",
    },
  },
  {
    id: "storm", name: "Storm", blurb: "Slate sky, with lightning", dark: true, display: '"Cinzel", "Trajan Pro", serif',
    ink: {
      paper: "#111720", card: "#17202b", sunk: "#1d2834", line: "#2a3644", line2: "#3a495b", grid: "#1c2631",
      fg: "#e9eef4", muted: "#9fb0c2", faint: "#6a7c90", accent: "#8fd3ff", accentFg: "#0b1220",
      att: "#6fd0ff", eng: "#b3a1ff", load: "#ffc35a", pulse: "#ff6f7d", ok: "#62d49a", bad: "#ff6464",
      screen: "#0a0e14", screen2: "#121a24",
    },
  },
  {
    id: "ember", name: "Ember", blurb: "Ash and molten orange", dark: true, display: '"Big Shoulders Display", "Arial Narrow", sans-serif',
    ink: {
      paper: "#13100e", card: "#1a1614", sunk: "#221d1a", line: "#312924", line2: "#453932", grid: "#241e1a",
      fg: "#efe6dc", muted: "#b3a597", faint: "#7d6f63", accent: "#ff6a2b", accentFg: "#160c07",
      att: "#5ecbd6", eng: "#b49cff", load: "#ffb547", pulse: "#ff6470", ok: "#7bd389", bad: "#ff5b4d",
      screen: "#0a0807", screen2: "#16120f",
    },
  },
  {
    id: "speedway", name: "Speedway", blurb: "Desert sand, race red, checkers", dark: false, display: '"Russo One", "Arial Black", sans-serif',
    ink: {
      paper: "#f7eee1", card: "#fffaf3", sunk: "#f3e5d1", line: "#ead6bc", line2: "#dcc09c", grid: "#f1e1cb",
      fg: "#231a13", muted: "#6f5a48", faint: "#a08a74", accent: "#d42a1c", accentFg: "#ffffff",
      att: "#0077a8", eng: "#5b3fb0", load: "#b86600", pulse: "#c8283f", ok: "#2e7d4f", bad: "#b42318",
      screen: "#1b1410", screen2: "#271d17",
    },
  },
];

const byId = (id: string | null | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Live palette for canvas / SVG / chart code. Updated in place on theme change. */
export const INK: Palette = { ...PAPER };

/** Lighter versions of the pen inks for drawing on the dark camera viewfinder. */
export const ON_SCREEN = {
  att: "#5cc8e0",
  eng: "#a594f0",
  load: "#f0b24a",
  pulse: "#f2788b",
  fg: "#f1ebdf",
} as const;

/** "r, g, b" for rgba() strings. */
export const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ");
};

/** Shared uPlot axis styling. Getters, so a chart built after a theme change picks it up. */
export const AXIS = {
  get stroke() {
    return INK.faint;
  },
  get grid() {
    return { stroke: INK.grid, width: 1 };
  },
  get ticks() {
    return { stroke: INK.line, width: 1, size: 4 };
  },
  font: "11px IBM Plex Sans",
};

const VARS: [keyof Palette, string][] = [
  ["paper", "bg"], ["card", "panel"], ["sunk", "panel-2"], ["line", "line"], ["line2", "line-2"], ["grid", "grid"],
  ["fg", "fg"], ["muted", "muted"], ["faint", "faint"], ["accent", "accent"], ["accentFg", "accent-fg"],
  ["att", "att"], ["eng", "eng"], ["load", "load"], ["pulse", "pulse"], ["ok", "ok"], ["bad", "bad"],
  ["screen", "screen"], ["screen2", "screen-2"],
];

function paint(t: Theme) {
  const root = document.documentElement;
  for (const [k, v] of VARS) root.style.setProperty(`--color-${v}`, t.ink[k]);
  root.style.setProperty("--font-serif", t.display);
  root.dataset.theme = t.id;
  root.dataset.mode = t.dark ? "dark" : "light";
  root.style.colorScheme = t.dark ? "dark" : "light";
  Object.assign(INK, t.ink);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.ink.paper);
}

const KEY = "lucid.theme";
const saved = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const useTheme = create<{ id: ThemeId }>(() => ({ id: byId(saved()).id }));

/** Call once before the first render. */
export function initTheme() {
  paint(byId(useTheme.getState().id));
}

/**
 * Switch theme. With a click point, the new theme spreads out from it in a
 * circle (View Transitions); otherwise it swaps instantly.
 */
export function setTheme(id: ThemeId, from?: { x: number; y: number }) {
  const t = byId(id);
  try {
    localStorage.setItem(KEY, t.id);
  } catch {
    /* storage unavailable */
  }
  const apply = () => {
    paint(t);
    flushSync(() => useTheme.setState({ id: t.id }));
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!from || reduce || !document.startViewTransition) return apply();

  const root = document.documentElement;
  root.dataset.vt = "theme";
  const vt = document.startViewTransition(apply);
  const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
  vt.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.45, 0, 0.15, 1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => {});
  vt.finished.finally(() => delete root.dataset.vt);
}
