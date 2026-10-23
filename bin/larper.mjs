#!/usr/bin/env node
// Launcher: runs the compiled build when there is one (`npm run build`),
// and falls back to running the TypeScript source through tsx.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(root, "dist", "cli.js");

if (existsSync(built)) {
  await import(pathToFileURL(built).href);
} else {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli", { paths: [root] });
  const child = spawn(process.execPath, [tsxCli, join(root, "src", "cli.tsx"), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
