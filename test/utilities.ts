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

import * as vm from "node:vm";
import Peggy from "peggy";
import * as Morph from "ts-morph";
import * as plugin from "../index.ts";

export function generate(grammarSource: string, control: boolean = false): Peggy.Parser {
  return Peggy.generate(
    grammarSource,
    {
      format: "bare",
      output: "parser",
      plugins: control ? [] : [plugin],
      grammarSource,
    }
  );
}

export function run(
  grammarSource: string,
  input: string,
  control: boolean = false
): any {
  const parser = generate(grammarSource, control);

  return parser.parse(input);
}
