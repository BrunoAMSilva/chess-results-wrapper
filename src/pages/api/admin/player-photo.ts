import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import {
  findPlayerByNationalId,
  findPlayerByFideIdExact,
  updatePlayerPhoto,
} from "../../../lib/db";
import { validateCsrfToken } from "../../../lib/csrf";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function getPhotosDir(): string {
  const dbPath =
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), "data", "chess-results.db");
  const dir = path.join(path.dirname(dbPath), "photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const csrfToken = request.headers.get("x-csrf-token");
  const csrfCookie = cookies.get("csrf-token")?.value;

  // Debug logging
  console.log("[CSRF] POST request debug:", {
    csrfTokenHeader: csrfToken ? "present" : "missing",
    csrfCookie: csrfCookie ? "present" : "missing",
    match: csrfToken && csrfCookie ? csrfToken === csrfCookie : "N/A",
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
  });

  if (!validateCsrfToken(csrfCookie, csrfToken || undefined)) {
    console.log("[CSRF] Validation failed");
    return new Response(
      JSON.stringify({ error: "Invalid CSRF token" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: {
    national_id?: string;
    fide_id?: string;
    federation?: string;
    photo?: string;
    photoType?: string;
    photoName?: string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nationalId = (body.national_id || "").trim();
  const federation = (body.federation || "").trim();
  const fideId = (body.fide_id || "").trim();
  const photo = body.photo; // base64 string
  const photoType = body.photoType || "image/jpeg";
  const photoName = body.photoName || "photo.jpg";

  if (!nationalId && !fideId) {
    return new Response(
      JSON.stringify({ error: "Provide national_id or fide_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (nationalId && !federation) {
    return new Response(
      JSON.stringify({ error: "federation is required when using national_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!photo || typeof photo !== "string") {
    return new Response(JSON.stringify({ error: "No photo data provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(photoType)) {
    return new Response(
      JSON.stringify({ error: "Only JPEG, PNG and WebP images are allowed" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Decode base64 and check size
  let buffer: Buffer;
  try {
    buffer = Buffer.from(photo, "base64");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid base64 data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (buffer.length === 0 || buffer.length > MAX_SIZE_BYTES) {
    return new Response(JSON.stringify({ error: "File exceeds 5 MB limit" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve player
  let player = nationalId ? findPlayerByNationalId(nationalId, federation) : undefined;
  if (!player && fideId) player = findPlayerByFideIdExact(fideId);

  if (!player || !player.id) {
    return new Response(JSON.stringify({ error: "Player not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ext = EXT_MAP[photoType];
  const filename = `player_${player.id}.${ext}`;
  const photosDir = getPhotosDir();
  const filePath = path.join(photosDir, filename);

  // Remove old photo files for this player (different extension)
  for (const existingExt of Object.values(EXT_MAP)) {
    const old = path.join(photosDir, `player_${player.id}.${existingExt}`);
    if (old !== filePath) {
      try {
        fs.unlinkSync(old);
      } catch (_) {}
    }
  }

  fs.writeFileSync(filePath, buffer);

  const photoUrl = `/api/player-photo/${filename}`;
  updatePlayerPhoto(player.id, photoUrl);

  return new Response(
    JSON.stringify({ ok: true, player_id: player.id, photo_url: photoUrl }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const csrfToken = request.headers.get("x-csrf-token");
  const csrfCookie = cookies.get("csrf-token")?.value;

  if (!validateCsrfToken(csrfCookie, csrfToken || undefined)) {
    return new Response(
      JSON.stringify({ error: "Invalid CSRF token" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: { national_id?: string; federation?: string; fide_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON body required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nationalId = body.national_id?.trim() || "";
  const federation = body.federation?.trim() || "";
  const fideId = body.fide_id?.trim() || "";

  if (!nationalId && !fideId) {
    return new Response(
      JSON.stringify({ error: "Provide national_id or fide_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (nationalId && !federation) {
    return new Response(
      JSON.stringify({ error: "federation is required when using national_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let player = nationalId ? findPlayerByNationalId(nationalId, federation) : undefined;
  if (!player && fideId) player = findPlayerByFideIdExact(fideId);

  if (!player || !player.id) {
    return new Response(JSON.stringify({ error: "Player not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Remove file if present
  if (player.photo_url) {
    const filename = path.basename(player.photo_url);
    const photosDir = getPhotosDir();
    try { fs.unlinkSync(path.join(photosDir, filename)); } catch (_) {}
  }

  updatePlayerPhoto(player.id, null);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
