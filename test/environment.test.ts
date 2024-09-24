// Copyright 2024 Dan Hudlow
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as Peggy from "peggy";
import { run } from "./utilities.ts";

function actionGrammar(code: string) {
  return `
    start = a / b
    a = [0-9]+
    b = c s @d
    c = "hello"
    d = foo:"world" { ${code} }
    s = " "
  `;
}

function testAction(code: string) {
  test("correct result for `" + code + "`", async () => {
    const grammar = `
      start = a / b
      a = [0-9]+
      b = c s @d
      c = "hello"
      d = foo:"world" { return ${code} }
      s = " "
    `;

    const out = await run(grammar, `hello world`);

    const control = await run(grammar, `hello world`, true);

    // expect(out.success).toBe(true);
    expect(out).toEqual(control);
  });
}

testAction("input");
testAction("options");
testAction("location()");
testAction("range()");
testAction("offset()");
testAction("text()");
testAction("foo /* label */");
