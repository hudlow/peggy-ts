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

import * as Morph from "ts-morph";

export default function inferReturnType(
  code: string,
  name: string,
  header?: string,
  files?: Record<string, string>,
): string {
  const project = new Morph.Project();

  const file = project.createSourceFile(
    "__temp__.ts",
    header + code,
  );

  project.resolveSourceFileDependencies();

  const func = file.getFunction(name);

  if (func === undefined) {
    throw new Error("function not found");
  }

  return func.getReturnType().getText(func);
}
