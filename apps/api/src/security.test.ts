import { describe, expect, it } from "vitest";
import { hashToken, newRefreshToken } from "./security.js";

describe("refresh token security", () => {
  it("creates opaque, unique tokens and stores only deterministic hashes", () => {
    const first = newRefreshToken();
    const second = newRefreshToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(40);
    expect(hashToken(first)).toHaveLength(64);
    expect(hashToken(first)).toBe(hashToken(first));
    expect(hashToken(first)).not.toContain(first);
  });
});

