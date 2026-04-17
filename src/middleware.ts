import { defineMiddleware } from "astro:middleware";
import { verifySessionToken, type AuthUser } from "./lib/firebase-admin";

const PROTECTED_PAGE_PREFIXES = ["/referee", "/present"];
const PROTECTED_API_PREFIXES = [
  "/api/referee-result",
  "/api/referee-upload",
  "/api/referee-upload-status",
  "/api/referee-export",
  "/api/tournament-config",
];

const PUBLIC_PATHS = ["/login"];

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

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies } = context;
  const pathname = url.pathname;

  // Skip auth check for public and non-protected routes
  if (isPublicPath(pathname) || !isProtectedRoute(pathname)) {
    return next();
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
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("redirect", pathname + url.search);
    return context.redirect(loginUrl.toString());
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
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("redirect", pathname + url.search);
    return context.redirect(loginUrl.toString());
  }

  // Store user in locals for pages/endpoints
  context.locals.user = user;

  return next();
});
