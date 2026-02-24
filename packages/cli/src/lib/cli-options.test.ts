import { describe, expect, it } from "vitest";
import { normalizeOptionalOption, parsePortOption, parsePositiveIntegerOption } from "./cli-options.js";

describe("cli options", () => {
  it("parses positive integer options strictly", () => {
    expect(parsePositiveIntegerOption("15", "--days")).toBe(15);
    expect(parsePositiveIntegerOption(" 42 ", "--days")).toBe(42);
  });

  it("rejects invalid positive integer option values", () => {
    for (const value of ["", "0", "-1", "3.5", "7days", "NaN"]) {
      expect(() => parsePositiveIntegerOption(value, "--days")).toThrow("--days must be a positive integer");
    }
  });

  it("parses and validates ports", () => {
    expect(parsePortOption("3030")).toBe(3030);
    expect(parsePortOption("65535")).toBe(65535);
    expect(() => parsePortOption("65536")).toThrow("--port must be between 1 and 65535");
    expect(() => parsePortOption("0")).toThrow("--port must be a positive integer");
  });

  it("normalizes optional text options", () => {
    expect(normalizeOptionalOption(undefined)).toBeUndefined();
    expect(normalizeOptionalOption("")).toBeUndefined();
    expect(normalizeOptionalOption("   ")).toBeUndefined();
    expect(normalizeOptionalOption("  rule  ")).toBe("rule");
  });
});
