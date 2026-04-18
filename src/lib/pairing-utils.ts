import type { Pairing } from "./types";

/**
 * True when a pairing row represents an actual game assignment.
 * chess-results.com emits placeholder rows (empty white, "bye" black) before
 * the round is paired; those are filtered out everywhere players are shown.
 */
export function isRealPairing(p: Pairing): boolean {
  return !!p.white?.name?.trim();
}

/**
 * True when a pairing represents a bye (one player sits out with a point).
 * Distinct from placeholder rows: a bye has a named white player and a
 * label like "BYE" / "Spielfrei" / result "1".
 */
export function isByePairing(p: Pairing): boolean {
  if (p.black) return false;
  const label = (p.unpairedLabel || "").toLowerCase();
  const normalizedResult = p.result.replace(/\s+/g, "").toLowerCase();
  return normalizedResult === "1" || label.includes("bye") || label.includes("spielfrei");
}
