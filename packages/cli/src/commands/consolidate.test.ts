import { describe, it, expect } from "vitest";
import { consolidateCommand } from "./consolidate.js";

describe("consolidate command", () => {
  it("registers run subcommand", () => {
    const names = consolidateCommand.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["run"]));
  });
});
