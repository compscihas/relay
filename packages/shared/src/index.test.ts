import { describe, expect, it } from "vitest";
import { normalizeUsername } from "./index.js";

describe("normalizeUsername", () => {
  it("normalizes handles from CLI and API input", () => {
    expect(normalizeUsername("  @Jordan_42 ")).toBe("jordan_42");
  });
});

