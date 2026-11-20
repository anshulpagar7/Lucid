// Page changes go through here so they animate with the View Transitions API
// (cross-fade + gentle rise, nav pill glides). Falls back to an instant switch.

import { flushSync } from "react-dom";
import { useLucid, type View } from "./store";

export function navigate(view: View) {
  const st = useLucid.getState();
  if (st.view === view) return;
  const apply = () => {
    flushSync(() => st.set({ view }));
    window.scrollTo({ top: 0 });
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (doc.startViewTransition && !reduce) doc.startViewTransition(apply);
  else apply();
}
