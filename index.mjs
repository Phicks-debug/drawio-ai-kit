#!/usr/bin/env node

// Public entrypoint. Import the engine from here, or run this file for commands.
export * from "./src/builder.mjs";
export * from "./src/layout-engine.mjs";
export * from "./src/core.mjs";
export * from "./src/types.mjs";
export * from "./src/theme.mjs";

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await import("./src/cli.mjs");
}
