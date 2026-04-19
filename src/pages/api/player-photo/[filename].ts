import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const GET: APIRoute = async ({ params }) => {
  const filename = params.filename ?? "";

  // Prevent path traversal
  const safe = path.basename(filename);
  if (!safe || safe !== filename) {
    return new Response("Not found", { status: 404 });
  }

  const dbPath =
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), "data", "chess-results.db");
  const filePath = path.join(path.dirname(dbPath), "photos", safe);

  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = safe.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = MIME_MAP[ext] ?? "application/octet-stream";
  const buffer = fs.readFileSync(filePath);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
