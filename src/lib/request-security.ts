function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getForwardedHeaderValue(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.split(",")[0]?.trim();
  return value || null;
}

function getEffectiveRequestOrigin(request: Request, url: URL): string {
  const forwardedProto = getForwardedHeaderValue(request, "x-forwarded-proto");
  const forwardedHost = getForwardedHeaderValue(request, "x-forwarded-host");
  const host = forwardedHost || request.headers.get("host")?.trim() || url.host;
  const protocol = forwardedProto || url.protocol.replace(/:$/, "");

  return `${protocol}://${host}`;
}

export function rejectUntrustedBrowserRequest(
  request: Request,
  url: URL,
): Response | null {
  const requestOrigin = getEffectiveRequestOrigin(request, url);
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
