import { describe, expect, it } from "vitest";
import {
  buildSelectedPlayerProfileHref,
  normalizePlayerIdentityValue,
  parseSelectedPlayerIdentity,
  playerIdentityMatches,
  serializeSelectedPlayerIdentity,
} from "../../src/lib/player-identity";

describe("player identity helpers", () => {
  it("normalizes player names consistently", () => {
    expect(normalizePlayerIdentityValue("Silva, Bruno  ")).toBe("silva bruno");
    expect(normalizePlayerIdentityValue("  Silva Bruno")).toBe("silva bruno");
  });

  it("parses valid stored identities and rejects malformed payloads", () => {
    const raw = serializeSelectedPlayerIdentity({ name: "Bruno Silva", federation: "por" });

    expect(parseSelectedPlayerIdentity(raw)).toEqual(
      expect.objectContaining({ name: "Bruno Silva", federation: "POR" }),
    );
    expect(parseSelectedPlayerIdentity('{"name":1}')).toBeNull();
    expect(parseSelectedPlayerIdentity("not-json")).toBeNull();
  });

  it("matches by name and federation when both are present", () => {
    const selected = { name: "Silva, Bruno", federation: "POR" };

    expect(playerIdentityMatches(selected, { name: "Silva Bruno", federation: "POR" })).toBe(true);
    expect(playerIdentityMatches(selected, { name: "Silva Bruno", federation: "ESP" })).toBe(false);
  });

  it("falls back to name-only matching when federation is unavailable", () => {
    const selected = { name: "Silva, Bruno", federation: "POR" };

    expect(playerIdentityMatches(selected, { name: "Silva Bruno" })).toBe(true);
  });

  it("builds a player profile href with encoded parameters", () => {
    expect(
      buildSelectedPlayerProfileHref({ name: "Silva, Bruno", federation: "POR" }, 10),
    ).toBe("/player-profile?name=Silva%2C+Bruno&lang=10&fed=POR");
  });
});