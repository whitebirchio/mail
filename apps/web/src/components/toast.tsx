"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/** One toast at a time, bottom-left, with an optional action (Undo). Lives in the signed-in layout so it survives navigation. */
export interface Toast {
  message: string;
  action?: { label: string; run: () => void | Promise<void> };
  tone?: "info" | "error";
}

const Ctx = createContext<(t: Toast) => void>(() => {});
export const useToast = () => useContext(Ctx);

const SHOW_MS = 8000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: Toast) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...t, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), SHOW_MS);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 md:justify-start md:pl-6">
        {toast && (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-md items-center gap-4 rounded-lg px-4 py-3 text-sm shadow-lg ${toast.tone === "error" ? "bg-[var(--bad)] text-white" : "bg-[var(--text)] text-[var(--background)]"}`}
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="font-semibold underline-offset-2 hover:underline"
                onClick={() => {
                  setToast(null);
                  void toast.action!.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => setToast(null)}>
              ✕
            </button>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
