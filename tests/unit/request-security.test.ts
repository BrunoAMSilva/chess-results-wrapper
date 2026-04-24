import { describe, expect, it } from "vitest";

import { validateCsrfToken } from "../../src/lib/csrf";
import { rejectUntrustedBrowserRequest } from "../../src/lib/request-security";

describe("rejectUntrustedBrowserRequest", () => {
  const url = new URL("https://example.com/api/referee-result");

  it("allows same-origin origin headers", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { origin: "https://example.com" },
    });

    expect(rejectUntrustedBrowserRequest(request, url)).toBeNull();
  });

  it("rejects cross-origin origin headers", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    const response = rejectUntrustedBrowserRequest(request, url);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "Cross-origin browser request blocked",
    });
  });

  it("allows same-origin referers when origin is absent", () => {
    const request = new Request(url, {
      method: "POST",
      headers: { referer: "https://example.com/referee/123" },
    });

    expect(rejectUntrustedBrowserRequest(request, url)).toBeNull();
  });

  it("rejects malformed referers", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { referer: "not-a-url" },
    });

    const response = rejectUntrustedBrowserRequest(request, url);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "Invalid referer header",
    });
  });

  it("rejects cross-site browser fetches without origin or referer", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });

    const response = rejectUntrustedBrowserRequest(request, url);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "Cross-origin browser request blocked",
    });
  });

  it("allows requests without browser-origin headers", () => {
    const request = new Request(url, { method: "POST" });

    expect(rejectUntrustedBrowserRequest(request, url)).toBeNull();
  });
});

describe("validateCsrfToken", () => {
  it("returns true for matching tokens", () => {
    const token = "a".repeat(64);

    expect(validateCsrfToken(token, token)).toBe(true);
  });

  it("returns false instead of throwing for different token lengths", () => {
    expect(validateCsrfToken("a".repeat(64), "short")).toBe(false);
  });
});
