import { describe, expect, it, vi } from "vitest";
import { getIntParam, getLangParam } from "../../src/lib/request-params";
import { resolvePageLang } from "../../src/lib/page-lang";

describe("request param helpers", () => {
  it("getIntParam should clamp invalid values to default", () => {
    expect(getIntParam("abc", 9, 1, 50)).toBe(9);
    expect(getIntParam("0", 9, 1, 50)).toBe(9);
    expect(getIntParam("99", 9, 1, 50)).toBe(9);
  });

  it("getIntParam should accept valid values", () => {
    expect(getIntParam("25", 9, 1, 50)).toBe(25);
  });

  it("getLangParam should accept only supported languages", () => {
    expect(getLangParam("1")).toBe(1);
    expect(getLangParam("10")).toBe(10);
    expect(getLangParam("999")).toBe(1);
  });
});

describe("resolvePageLang", () => {
  it("should read valid language from query and persist sanitized cookie", () => {
    const url = new URL("https://example.com/standings?lang=10");
    const set = vi.fn();
    const cookies = { get: () => undefined, set };

    const lang = resolvePageLang(url, cookies);

    expect(lang).toBe(10);
    expect(set).toHaveBeenCalledWith(
      "lang",
      "10",
      expect.objectContaining({ path: "/", sameSite: "lax", httpOnly: false }),
    );
  });

  it("should fall back to cookie language when query is absent", () => {
    const url = new URL("https://example.com/standings");
    const set = vi.fn();
    const cookies = { get: () => ({ value: "2" }), set };

    const lang = resolvePageLang(url, cookies);

    expect(lang).toBe(2);
    expect(set).not.toHaveBeenCalled();
  });

  it("should sanitize invalid query language before persisting", () => {
    const url = new URL("https://example.com/standings?lang=999");
    const set = vi.fn();
    const cookies = { get: () => ({ value: "10" }), set };

    const lang = resolvePageLang(url, cookies);

    expect(lang).toBe(1);
    expect(set).toHaveBeenCalledWith(
      "lang",
      "1",
      expect.objectContaining({ path: "/", sameSite: "lax", httpOnly: false }),
    );
  });
});
