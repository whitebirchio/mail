"use client";

import { useEffect, useState } from "react";

/**
 * Gmail-style keys (SPEC.md, story 9). Buttons and links opt in with
 * data-shortcut="<key>"; a key clicks the match in the focused row first,
 * then in a toolbar, then anywhere on the page. Off while typing.
 */
export const KEYS: [string, string][] = [
  ["j / k", "Next / previous conversation in a list"],
  ["o or Enter", "Open"],
  ["x", "Select the conversation"],
  ["e", "Archive"],
  ["#", "Delete"],
  ["!", "Report spam"],
  ["s", "Star or unstar"],
  ["Shift + I / U", "Mark read / unread"],
  ["r / a / f", "Reply / reply all / forward"],
  ["c", "Compose"],
  ["/", "Search"],
  ["u", "Back to the list"],
  ["?", "Show these shortcuts"],
];

/** The shortcut a key event means, or null. Shift only matters for letters (I/U); symbols arrive shifted already. */
export function keyOf(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return e.key.length === 1 || e.key === "Enter" ? e.key : null;
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const ROWS = "main ul > li";

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROWS)).filter((li) => li.querySelector('a[href^="/t/"]'));
}

function focusedRow(): HTMLElement | null {
  return (document.activeElement?.closest(ROWS) as HTMLElement | null) ?? null;
}

function moveRow(step: 1 | -1) {
  const all = rows();
  if (all.length === 0) return;
  const at = focusedRow();
  const i = at ? all.indexOf(at) : -1;
  const next = all[Math.min(all.length - 1, Math.max(0, i === -1 ? 0 : i + step))];
  const link = next?.querySelector<HTMLElement>('a[href^="/t/"]');
  link?.focus();
  link?.scrollIntoView({ block: "nearest" });
}

function clickShortcut(key: string): boolean {
  const sel = `[data-shortcut="${CSS.escape(key)}"]`;
  const row = focusedRow();
  const target =
    row?.querySelector<HTMLElement>(sel) ??
    // A bulk toolbar acts only when something is selected; its buttons exist only then.
    document.querySelector<HTMLElement>(`[role="toolbar"] ${sel}`) ??
    // Row buttons only answer for their own focused row, never as a page-wide fallback.
    Array.from(document.querySelectorAll<HTMLElement>(sel))
      .filter((el) => !el.closest(ROWS) || el.closest("article"))
      .at(-1) ??
    null;
  if (!target || (target as HTMLButtonElement).disabled) return false;
  target.click();
  return true;
}

export function Shortcuts() {
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      const key = keyOf(e);
      if (!key) return;
      if (key === "?") return void (setHelp((h) => !h), e.preventDefault());
      if (key === "Escape") return setHelp(false);
      if (key === "/") {
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        return e.preventDefault();
      }
      if (key === "j" || key === "k") return void (moveRow(key === "j" ? 1 : -1), e.preventDefault());
      if (key === "o") {
        const link = focusedRow()?.querySelector<HTMLElement>('a[href^="/t/"]');
        if (link) return void (link.click(), e.preventDefault());
      }
      if (key === "x") {
        const box = focusedRow()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (box) return void (box.click(), e.preventDefault());
      }
      if (clickShortcut(key)) e.preventDefault();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onEsc);
    };
  }, []);

  if (!help) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="keys-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHelp(false)}>
      <div className="w-full max-w-md rounded-xl bg-[var(--raised)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id="keys-title" className="text-base font-semibold">
            Keyboard shortcuts
          </h2>
          <button type="button" onClick={() => setHelp(false)} className="text-sm text-[var(--muted)] hover:text-[var(--text)]" autoFocus>
            Close
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {KEYS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-[var(--muted)]">{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
