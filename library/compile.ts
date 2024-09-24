import Peggy from "peggy";
import * as Morph from "ts-morph";

export default function compile(
  code: string,
  options: Peggy.ParserBuildOptions,
): string {
  // refer to https://github.com/microsoft/TypeScript/blob/main/src/server/protocol.ts
  const compilerOptions: Morph.ts.CompilerOptions = {
    target: Morph.ts.ScriptTarget.ES2023,
    module: Morph.ts.ModuleKind.CommonJS,
  };

  if (options.output === "parser") {
    if (!["bare", undefined].includes(options.format)) {
      throw new Error(
        'only `format = "bare"` is compatible with `output = "parser"`',
      );
    } else if (options.typescript === true) {
      throw new Error(
        '`typescript = true` is not compatible with `output = "parser"`',
      );
    }
  }

  if (options.format === "es") {
    compilerOptions.module = Morph.ts.ModuleKind.Node16;
    compilerOptions.moduleResolution = Morph.ts.ModuleResolutionKind.Node16;
    compilerOptions.esModuleInterop = true;
  }

  const project = new Morph.Project({ compilerOptions });

  const file = project.createSourceFile(
    "__parser__.ts",
    code.replace(/\s*\n\s*/g, "\n"),
  );

  file.formatText({ indentSize: 2 });
  project.resolveSourceFileDependencies();
  let formattedCode = file.getText();

  if (options.typescript === true) {
    return formattedCode;
  }

  const emitOutput = file.getEmitOutput();

  for (const outputFile of emitOutput.getOutputFiles()) {
    if (outputFile.getFilePath().endsWith(`__parser__.js`)) {
      formattedCode = outputFile.getText();
    }
  }

  if (options.format === "bare") {
    formattedCode = `
      (
        () => {
          let exports = {};
          let module = { exports };

          ${formattedCode}

          return module.exports;
        }
      )()
    `;
  }

  return formattedCode;
}
