/**
 * Structured logger for internal/server logging.
 * Use this for non-user-facing messages (lib internals, MCP server, diagnostics).
 * For user-facing CLI output, use the helpers in ui.ts instead.
 *
 * All output goes to stderr so it doesn't interfere with MCP stdio protocol.
 */

import { isDebug } from "./env.js";

const PREFIX = "[memories]";

export const logger = {
  error(msg: string, ...args: unknown[]): void {
    console.error(`${PREFIX} ${msg}`, ...args);
  },

  warn(msg: string, ...args: unknown[]): void {
    console.error(`${PREFIX} WARN ${msg}`, ...args);
  },

  info(msg: string, ...args: unknown[]): void {
    console.error(`${PREFIX} ${msg}`, ...args);
  },

  debug(msg: string, ...args: unknown[]): void {
    if (isDebug()) {
      console.error(`${PREFIX} DEBUG ${msg}`, ...args);
    }
  },
};
