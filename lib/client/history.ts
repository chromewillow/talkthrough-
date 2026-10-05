import type { Walkthrough } from "@/lib/narrate/types";

/**
 * Keeps the most recent finished walkthrough in this browser, so a refresh or
 * a closed tab doesn't throw away minutes of generation.
 */
const KEY = "talkthrough:last:v1";

export function saveLast(w: Walkthrough) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    // Storage full or unavailable: nothing to do.
  }
}

export function loadLast(): Walkthrough | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Walkthrough;
    return w && Array.isArray(w.sections) && typeof w.overview === "string" ? w : null;
  } catch {
    return null;
  }
}

export function clearLast() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
