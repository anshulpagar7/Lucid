import { create } from "zustand";

/** Replay playhead — its own tiny store so 60 fps updates don't re-render the page. */
export const useClock = create<{ time: number; playing: boolean; speed: number; set: (p: Partial<{ time: number; playing: boolean; speed: number }>) => void }>((set) => ({
  time: 0,
  playing: false,
  speed: 4,
  set: (p) => set(p),
}));
