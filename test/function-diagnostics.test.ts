import * as assert from "node:assert/strict";
import { suite, test } from "node:test";

import getFunctionDiagnostics from "../library/function-diagnostics.js";

suite("function-diagnostics.ts", () => {
  test("used parameter", () => {
    const diagnostics = getFunctionDiagnostics(
      `function foo(a: string) { return a; }`,
      "foo",
    );

    assert.deepEqual(diagnostics.unusedArgs, []);
  });
  test("unused parameter", () => {
    const diagnostics = getFunctionDiagnostics(
      `function foo(a) { if (true) { const a = 1; return a; } }`,
      "foo",
    );

    assert.deepEqual(
      {
        returnType: "number",
        unusedArgs: ["a"],
      },
      diagnostics,
    );
  });
});
