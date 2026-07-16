#!/usr/bin/env node
// Removes build artifacts and caches. Cross-platform (uses fs.rmSync, not
// `rm -rf`) so `npm run clean` works the same on Windows/macOS/Linux and in
// CI, matching how the rest of this project's scripts are invoked via npm
// across a Windows dev machine and Linux GitHub Actions runners.

import { rmSync, existsSync } from "node:fs";

const TARGETS = [
  ".output",
  ".vercel/output",
  "dist",
  "dist-ssr",
  "node_modules/.vite",
  "node_modules/.cache",
];

for (const target of TARGETS) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`removed ${target}`);
  }
}

console.log("clean: done");
