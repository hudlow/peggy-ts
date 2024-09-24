#!/usr/bin/env tsx

import fs from "node:fs";

const runtime = fs.readFileSync("./source/runtime.ts", "utf8");

fs.writeFileSync(
  "./library/runtime.ts",
  [
    "// This file is generated from source/runtime.ts",
    "// To regenerate, run `npm run prepare`",
    `const runtime = ${JSON.stringify(runtime)};`,
    "export default runtime;",
  ].join("\n"),
);
