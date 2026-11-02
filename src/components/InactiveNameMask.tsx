/**
 * Flags deactivated people's names on screen — "Jane Doe (Deactivated)" (see lib/inactiveNames.ts
 * for where they're kept). Works on the rendered page — text and tooltips —
 * so it covers every screen without touching what's stored, and PDFs (built
 * in their own iframe) are never affected. A dropdown option that is only a
 * deactivated person's name is hidden instead of listed.
 *
 * Wrap anything that must keep real names in data-keep-names.
 */
import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { getCompanyUsersLite } from "@/lib/supabase/users";
import { isInactiveName, keepsInactiveNames, maskInactiveNames, onInactiveNamesChange, setInactiveNamesFromRoster } from "@/lib/inactiveNames";

const SKIP_SELECTOR = "[data-keep-names],script,style,textarea,[contenteditable='true']";
// A dropdown option that is just their name is hidden; everywhere else the name is replaced (never blank).
const PICKER_ROW_SELECTOR = "option,[role='option'],[role='menuitem'],[role='menuitemcheckbox']";
const ROSTER_REFRESH_MS = 10 * 60_000;

function maskTextNode(node: Text) {
  const value = node.nodeValue;
  if (!value) return;
  const masked = maskInactiveNames(value);
  if (masked === null) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP_SELECTOR)) return;
  // A picker row that is just their name: hide the row.
  const row = parent.closest<HTMLElement>(PICKER_ROW_SELECTOR);
  if (row && isInactiveName(row.textContent)) {
    if (row instanceof HTMLOptionElement) {
      row.hidden = true;
      row.disabled = true;
    } else {
      row.style.display = "none";
    }
    return;
  }
  node.nodeValue = masked;
}

function maskTitle(el: Element) {
  const title = el.getAttribute("title");
  if (!title) return;
  const masked = maskInactiveNames(title);
  if (masked !== null && !el.closest(SKIP_SELECTOR)) el.setAttribute("title", masked);
}

function maskTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    maskTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) maskTextNode(n as Text);
  maskTitle(el);
  el.querySelectorAll("[title]").forEach(maskTitle);
}

export function InactiveNameMask() {
  const { ready, uid } = useAuth();
  const { pathname } = useLocation();
  const active = !keepsInactiveNames(pathname);

  // Keeps the list of deactivated names current (the roster loaders elsewhere refresh it too).
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    const load = () =>
      getCompanyUsersLite()
        .then((rows) => { if (!cancelled) setInactiveNamesFromRoster(rows); })
        .catch(() => {});
    void load();
    const t = window.setInterval(load, ROSTER_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [ready, uid]);

  useEffect(() => {
    if (!active) return;
    // Runs before paint (microtask), so the real name never flashes.
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") maskTextNode(r.target as Text);
        else if (r.type === "attributes") maskTitle(r.target as Element);
        else r.addedNodes.forEach(maskTree);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title"] });
    maskTree(document.body);
    const off = onInactiveNamesChange(() => maskTree(document.body));
    return () => { observer.disconnect(); off(); };
  }, [active]);

  return null;
}
