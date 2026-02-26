import { describe, it, expect } from "vitest";
import { compactCommand } from "./compact.js";

describe("compact command", () => {
  it("registers run subcommand", () => {
    const names = compactCommand.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["run"]));
  });
});
