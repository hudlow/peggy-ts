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
import { run, generate } from "./utilities.ts";

test("Correct syntax error type", () => {
  const parser = generate('a = "1"');

  expect(() => {
    parser.parse("2");
  }).toThrow(parser.SyntaxError);
});

function testInput(input: string) {
  test("correct error for `" + input + "`", () => {
    const grammar = `
      start = a / b
      a = $([0-9]+ / [xyz])
      b = c s d
      c "greeting" = "hello" / "hola" / "bonjour"
      d = "world"
      s = " "
    `;

    let error, controlError;

    try {
      run(
        grammar,
        input,
      );
    } catch (e) {
      error = e;
    }

    try {
      run(
        grammar,
        input,
        true
      );
    } catch (e) {
      controlError = e;
    }


    expect(error).toBeInstanceOf(Error);
    expect(controlError).toBeInstanceOf(Error);

    if (!(error instanceof Error) || !(controlError instanceof Error)) {
      return;
    }

    expect(error.toString()).toEqual(controlError.toString());
  });
}

// testInput("hi");
