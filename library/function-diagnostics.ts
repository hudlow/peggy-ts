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

import { Project, SyntaxKind } from "ts-morph";

export interface FunctionDiagnostics {
  returnType: string;
  unusedArgs: string[];
}

export default function getFunctionDiagnostics(
  code: string,
  name: string,
  header: string = "",
): FunctionDiagnostics {
  const project = new Project();

  const file = project.createSourceFile("__temp__.ts", header + code);

  project.resolveSourceFileDependencies();

  const func = file.getFunction(name);

  if (func === undefined) {
    throw new Error("function not found");
  }

  const args = func.getParameters();
  const identifiers =
    func.getBody()?.getDescendantsOfKind(SyntaxKind.Identifier) ?? [];
  const referencedDefinitions = identifiers.flatMap((i) => i.getDefinitions());
  const referencedDeclarations = [
    ...new Set(referencedDefinitions.map((d) => d.getDeclarationNode())),
  ];
  const unusedArgs = args.filter((p) => !referencedDeclarations.includes(p));

  return {
    returnType: func.getReturnType().getText(func),
    unusedArgs: unusedArgs.map((p) => p.getName()),
  };
}
