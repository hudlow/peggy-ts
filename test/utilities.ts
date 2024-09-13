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
import * as Peggy from "peggy";
import * as Morph from "ts-morph";
import * as plugin from "../index.ts";

export function generate(grammarSource: string, control: boolean = false): Function {
  const source = Peggy.generate(
    grammarSource,
    {
      format: "es",
      output: "source",
      plugins: control ? [] : [plugin],
      grammarSource,
    },
  );

  const project = new Morph.Project({
    compilerOptions: {
      target: Morph.ScriptTarget.ES5
    }
  });

  const file = project.createSourceFile(
    "__parser__.ts",
    source,
  );

  const emitOutput = file.getEmitOutput();
  let compiledCode: string = "";

  for (const outputFile of emitOutput.getOutputFiles()) {
    if (outputFile.getFilePath().endsWith(`__parser__.js`)) {
      compiledCode = outputFile.getText();
    } else {
      throw new Error(`unexpected file: ${outputFile.getFilePath()}`);
    }
  }

  const context: Result = {
    exports: {}
  };

  vm.runInNewContext(compiledCode, context);

  if (typeof context.exports?.parse === "function") {
    return context.exports?.parse;
  } else {
    throw new Error();
  }
}

export interface Result {
  exports: Record<string, unknown>
}

export function run(
  grammarSource: string,
  input: string,
  control: boolean = false
): Result {
  const parse = generate(grammarSource, control);

  return parse(input);
}
