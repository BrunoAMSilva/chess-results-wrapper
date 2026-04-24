import { defineMiddleware } from "astro:middleware";
import { verifySessionToken, type AuthUser } from "./lib/firebase-admin";

const PROTECTED_PAGE_PREFIXES = ["/referee", "/present", "/admin"];
const PROTECTED_API_PREFIXES = [
  "/api/referee-result",
  "/api/referee-upload",
  "/api/referee-upload-status",
  "/api/referee-export",
  "/api/tournament-config",
  "/api/admin",
];

const PUBLIC_PATHS = ["/login"];

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://firebaseinstallations.googleapis.com https://firebase.googleapis.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com",
    "frame-src https://accounts.google.com https://criticalmoves.firebaseapp.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; "),
};

function isProtectedRoute(pathname: string): boolean {
  for (const prefix of PROTECTED_PAGE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return true;
  }
  for (const prefix of PROTECTED_API_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return true;
  }
  return false;
}

function isPublicPath(pathname: string): boolean {
  for (const p of PUBLIC_PATHS) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function addSecurityHeaders(response: Response, request: Request, url: URL): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (url.protocol === "https:" || forwardedProto === "https") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies, request } = context;
  const pathname = url.pathname;

  // Debug: log all POST requests to admin endpoints
  if (request.method === "POST" && pathname.startsWith("/api/admin")) {
    console.log("[MIDDLEWARE] POST to admin endpoint:", {
      pathname,
      contentType: request.headers.get("content-type"),
      hasXCsrfToken: !!request.headers.get("x-csrf-token"),
    });
  }

  // Skip auth check for public and non-protected routes
  if (isPublicPath(pathname) || !isProtectedRoute(pathname)) {
    return addSecurityHeaders(await next(), request, url);
  }

  // Check for auth token in cookie
  const token = cookies.get("__session")?.value;

  if (!token) {
    if (isApiRoute(pathname)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const redirect = encodeURIComponent(pathname + url.search);
    return context.redirect(`/login?redirect=${redirect}`);
  }

  const user = await verifySessionToken(token);

  if (!user) {
    // Token invalid or expired — clear it
    cookies.delete("__session", { path: "/" });

    if (isApiRoute(pathname)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const redirect = encodeURIComponent(pathname + url.search);
    return context.redirect(`/login?redirect=${redirect}`);
  }

  // Store user in locals for pages/endpoints
  context.locals.user = user;

  return addSecurityHeaders(await next(), request, url);
});
