import { useEffect } from "react";
import { useLucid } from "../store";
import { navigate } from "../nav";

export function Toast() {
  const toast = useLucid((s) => s.toast);
  const set = useLucid((s) => s.set);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => set({ toast: null }), 6000);
    return () => clearTimeout(id);
  }, [toast, set]);
  if (!toast) return null;
  return (
    <div className="fade-in float fixed bottom-6 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-4 rounded-xl border border-line-2 bg-panel px-4 py-2.5">
      <span className="text-[13px]">{toast.msg}</span>
      {toast.action && (
        <button className="text-[13px] font-medium text-att hover:underline" onClick={() => { set({ toast: null }); navigate(toast.action!.view); }}>
          {toast.action.label}
        </button>
      )}
      <button className="text-faint hover:text-muted" onClick={() => set({ toast: null })} aria-label="Dismiss">✕</button>
    </div>
  );
}
