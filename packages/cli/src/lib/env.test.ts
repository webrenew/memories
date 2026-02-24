import { afterEach, describe, expect, it } from "vitest";
import { getApiUrl, isDebug } from "./env.js";

const ORIGINAL_API_URL = process.env.MEMORIES_API_URL;
const ORIGINAL_DEBUG = process.env.DEBUG;

afterEach(() => {
  if (ORIGINAL_API_URL === undefined) {
    delete process.env.MEMORIES_API_URL;
  } else {
    process.env.MEMORIES_API_URL = ORIGINAL_API_URL;
  }

  if (ORIGINAL_DEBUG === undefined) {
    delete process.env.DEBUG;
  } else {
    process.env.DEBUG = ORIGINAL_DEBUG;
  }
});

describe("env", () => {
  it("uses the default API URL when MEMORIES_API_URL is unset", () => {
    delete process.env.MEMORIES_API_URL;
    expect(getApiUrl()).toBe("https://memories.sh");
  });

  it("normalizes MEMORIES_API_URL by trimming and removing trailing slashes", () => {
    process.env.MEMORIES_API_URL = "  https://api.memories.sh///  ";
    expect(getApiUrl()).toBe("https://api.memories.sh");
  });

  it("falls back to default URL when MEMORIES_API_URL normalizes to empty", () => {
    process.env.MEMORIES_API_URL = "///";
    expect(getApiUrl()).toBe("https://memories.sh");
  });

  it("treats empty and false-like DEBUG values as disabled", () => {
    for (const value of ["", "0", "false", "FALSE", "off", "no", "n"]) {
      process.env.DEBUG = value;
      expect(isDebug()).toBe(false);
    }

    delete process.env.DEBUG;
    expect(isDebug()).toBe(false);
  });

  it("enables debug for truthy DEBUG values", () => {
    for (const value of ["1", "true", "yes", "verbose"]) {
      process.env.DEBUG = value;
      expect(isDebug()).toBe(true);
    }
  });
});
