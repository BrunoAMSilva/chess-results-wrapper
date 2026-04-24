import type { APIRoute } from "astro";
import { setTournamentConfig, getTournamentConfig } from "../../lib/db";
import { rejectUntrustedBrowserRequest } from "../../lib/request-security";

const SID_PATTERN = /^[0-9A-Fa-f]{32}$/;
const ALLOWED_KEYS = new Set(["sid", "sponsor_image", "sponsor_alt"]);
const MAX_URL_LENGTH = 2048;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validateConfigValue(key: string, value: string): string | null {
  if (key === "sid" && value && !SID_PATTERN.test(value)) {
    return "SID must be 32 hexadecimal characters";
  }
  if (key === "sponsor_image" && value) {
    if (value.length > MAX_URL_LENGTH) return "URL too long";
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return "Sponsor image must be an HTTP(S) URL";
      }
      // Note: only the URL format is validated here; the image content-type is not
      // verified at write time. The browser will render whatever the URL serves.
    } catch {
      return "Invalid URL";
    }
  }
  if (key === "sponsor_alt" && value.length > 200) {
    return "Alt text too long (max 200 characters)";
  }
  return null;
}

export const POST: APIRoute = async ({ request, url }) => {
  const blocked = rejectUntrustedBrowserRequest(request, url);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const tid = typeof body.tid === "string" ? body.tid : "";
    const key = typeof body.key === "string" ? body.key : "";
    const value = typeof body.value === "string" ? body.value : "";

    if (!tid) return jsonError("Missing tid", 400);
    if (!key) return jsonError("Missing key", 400);

    // Only allow known config keys
    if (!ALLOWED_KEYS.has(key)) return jsonError("Unknown config key", 400);

    const validationError = validateConfigValue(key, value);
    if (validationError) return jsonError(validationError, 400);

    setTournamentConfig(tid, key, value);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save config";
    return jsonError(message, 500);
  }
};

export const GET: APIRoute = async ({ url }) => {
  const tid = url.searchParams.get("tid");
  const key = url.searchParams.get("key");

  if (!tid) return jsonError("Missing tid", 400);
  if (!key) return jsonError("Missing key", 400);

  if (!ALLOWED_KEYS.has(key)) return jsonError("Unknown config key", 400);

  const value = getTournamentConfig(tid, key);

  // Mask the SID for security — only reveal first/last 4 chars
  if (key === "sid") {
    const masked = value ? value.slice(0, 4) + "…" + value.slice(-4) : null;
    return new Response(JSON.stringify({ configured: !!value, masked }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // For non-secret keys, return the value directly
  return new Response(JSON.stringify({ configured: !!value, value: value || null }), {
    headers: { "Content-Type": "application/json" },
  });
};
