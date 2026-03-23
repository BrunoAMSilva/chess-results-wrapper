export interface SelectedPlayerIdentity {
  name: string;
  federation: string;
  updatedAt?: string;
}

export const SELECTED_PLAYER_STORAGE_KEY = "selected-player";

export function normalizePlayerIdentityValue(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFKC")
    .replace(/,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isSelectedPlayerIdentity(value: unknown): value is SelectedPlayerIdentity {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      typeof value.name === "string" &&
      "federation" in value &&
      typeof value.federation === "string",
  );
}

export function parseSelectedPlayerIdentity(raw: string | null | undefined): SelectedPlayerIdentity | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!isSelectedPlayerIdentity(parsed)) return null;

    const name = parsed.name.trim();
    const federation = parsed.federation.trim().toUpperCase();
    if (!name) return null;

    return {
      name,
      federation,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeSelectedPlayerIdentity(identity: SelectedPlayerIdentity): string {
  return JSON.stringify({
    name: identity.name.trim(),
    federation: identity.federation.trim().toUpperCase(),
    updatedAt: identity.updatedAt || new Date().toISOString(),
  });
}

export function playerIdentityMatches(
  selected: SelectedPlayerIdentity | null | undefined,
  candidate: { name: string; federation?: string | null },
): boolean {
  if (!selected) return false;

  const selectedName = normalizePlayerIdentityValue(selected.name);
  const candidateName = normalizePlayerIdentityValue(candidate.name);
  if (!selectedName || !candidateName || selectedName !== candidateName) return false;

  const selectedFederation = normalizePlayerIdentityValue(selected.federation);
  const candidateFederation = normalizePlayerIdentityValue(candidate.federation);
  if (!selectedFederation || !candidateFederation) return true;

  return selectedFederation === candidateFederation;
}

export function buildSelectedPlayerProfileHref(identity: SelectedPlayerIdentity, lang: number): string {
  const params = new URLSearchParams({
    name: identity.name,
    lang: String(lang),
  });

  if (identity.federation.trim()) {
    params.set("fed", identity.federation.trim().toUpperCase());
  }

  return `/player-profile?${params.toString()}`;
}