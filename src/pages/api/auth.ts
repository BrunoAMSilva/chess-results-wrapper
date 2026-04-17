import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token : "";

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify the token server-side before setting the cookie
    const { verifySessionToken } = await import("../../lib/firebase-admin");
    const user = await verifySessionToken(token);

    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Set HTTP-only session cookie (1 hour expiry, matches Firebase token)
    cookies.set("__session", token, {
      path: "/",
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: "lax",
      maxAge: 60 * 60, // 1 hour
    });

    return new Response(JSON.stringify({ ok: true, user: { email: user.email, name: user.name } }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Login failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const DELETE: APIRoute = async ({ cookies }) => {
  cookies.delete("__session", { path: "/" });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
