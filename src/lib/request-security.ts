function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function rejectUntrustedBrowserRequest(
  request: Request,
  url: URL,
): Response | null {
  const requestOrigin = url.origin;
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === requestOrigin
      ? null
      : jsonError("Cross-origin browser request blocked", 403);
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === requestOrigin
        ? null
        : jsonError("Cross-origin browser request blocked", 403);
    } catch {
      return jsonError("Invalid referer header", 403);
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonError("Cross-origin browser request blocked", 403);
  }

  return null;
}
