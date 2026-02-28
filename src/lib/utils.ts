/**
 * Reverses "Last, First" or "LAST First" name format to "First Last".
 * Handles both comma-separated ("SILVA, Bruno") and
 * space-separated with uppercase last name ("SILVA Bruno").
 */
export function reverseName(name: string): string {
  if (!name) return name;

  // Case 1: Comma-separated "Last, First"
  if (name.includes(",")) {
    const [last, ...rest] = name.split(",");
    return `${rest.join(",").trim()} ${last.trim()}`;
  }

  // Case 2: Uppercase last name(s) followed by mixed-case first name
  // e.g. "MARTINEZ RAMIREZ Lennis" or "FONTELAS Diogo Rebelo"
  const words = name.split(/\s+/);
  if (words.length < 2) return name;

  // Find where the uppercase last name ends and first name begins
  const isUpperWord = (w: string) => w === w.toUpperCase() && /[A-ZÀ-Ý]/.test(w);
  let splitIdx = words.findIndex((w, i) => i > 0 && !isUpperWord(w));

  if (splitIdx <= 0) return name; // All uppercase or can't detect split

  const lastName = words.slice(0, splitIdx).join(" ");
  const firstName = words.slice(splitIdx).join(" ");
  return `${firstName} ${lastName}`;
}
