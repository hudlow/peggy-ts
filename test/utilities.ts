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

export function generate(grammarSource: string): string {
  const parser = Peggy.generate(
    grammarSource,
    {
      format: "es",
      output: "source",
      plugins: [plugin],
      grammarSource,
    },
  );

  return parser;
}

export interface Result {
  success: boolean;
  result?: string;
  message?: string;
}

export function run(
  grammarSource: string,
  input: string,
): Result {
  const parser = generate(grammarSource);
  const source = `
    const success = true;

    ${parser}

    try {
      success = true;
      result = parse(${JSON.stringify(input)});
    } catch (e: Error) {
      success = false;
      message = e.message;
    }
  `;

  const project = new Morph.Project({
    compilerOptions: {
      target: Morph.ScriptTarget.ES5
    }
  });

  const file = project.createSourceFile(
    "__temp__.ts",
    source,
  );

  const emitOutput = file.getEmitOutput();
  let compiledCode: string = "";

  for (const outputFile of emitOutput.getOutputFiles()) {
    if (outputFile.getFilePath().endsWith(`${file.getBaseNameWithoutExtension()}.js`)) {
      compiledCode = outputFile.getText();
    } else {
      throw new Error(`unexpected file: ${outputFile.getFilePath()}`);
    }
  }

  const context = {
    exports: {},
    success: false,
    result: undefined,
    message: undefined
  };

  vm.runInNewContext(compiledCode, context);

  return context;
}
