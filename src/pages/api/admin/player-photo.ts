import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import {
  findPlayerByNationalId,
  findPlayerByFideIdExact,
  updatePlayerPhoto,
} from "../../../lib/db";

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

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return new Response(JSON.stringify({ error: "multipart/form-data required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Failed to parse form data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nationalId = (formData.get("national_id") as string | null)?.trim() || "";
  const fideId = (formData.get("fide_id") as string | null)?.trim() || "";
  const photoFile = formData.get("photo");

  if (!nationalId && !fideId) {
    return new Response(
      JSON.stringify({ error: "Provide national_id or fide_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!(photoFile instanceof File) || photoFile.size === 0) {
    return new Response(JSON.stringify({ error: "No photo file uploaded" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!ALLOWED_MIME_TYPES.has(photoFile.type)) {
    return new Response(
      JSON.stringify({ error: "Only JPEG, PNG and WebP images are allowed" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (photoFile.size > MAX_SIZE_BYTES) {
    return new Response(JSON.stringify({ error: "File exceeds 5 MB limit" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve player
  let player = nationalId ? findPlayerByNationalId(nationalId) : undefined;
  if (!player && fideId) player = findPlayerByFideIdExact(fideId);

  if (!player || !player.id) {
    return new Response(JSON.stringify({ error: "Player not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ext = EXT_MAP[photoFile.type];
  const filename = `player_${player.id}.${ext}`;
  const photosDir = getPhotosDir();
  const filePath = path.join(photosDir, filename);

  // Remove old photo files for this player (different extension)
  for (const existingExt of Object.values(EXT_MAP)) {
    const old = path.join(photosDir, `player_${player.id}.${existingExt}`);
    if (old !== filePath) {
      try { fs.unlinkSync(old); } catch (_) {}
    }
  }

  const buffer = Buffer.from(await photoFile.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const photoUrl = `/api/player-photo/${filename}`;
  updatePlayerPhoto(player.id, photoUrl);

  return new Response(
    JSON.stringify({ ok: true, player_id: player.id, photo_url: photoUrl }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const DELETE: APIRoute = async ({ request }) => {
  let body: { national_id?: string; fide_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON body required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nationalId = body.national_id?.trim() || "";
  const fideId = body.fide_id?.trim() || "";

  if (!nationalId && !fideId) {
    return new Response(
      JSON.stringify({ error: "Provide national_id or fide_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let player = nationalId ? findPlayerByNationalId(nationalId) : undefined;
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
