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
import { run } from "./utilities";

test("parses input", async () => {
  const result = await run(
    `start = 'a'`,
    `a`,
  );

  // expect(success).toBe(true);
  expect(result).toBe("a");
});

test.skip("throws an exception on syntax error", async () => {
  const result = await run(
    `start = 'a'`,
    `b`,
  );

  // expect(success).toBe(false);
  expect(result).toBe(undefined);
});

test("handles end of input on first choice", async () => {
  const result = await run(
    `start = "abc" / "ab"`,
    `ab`,
  );

  // expect(success).toBe(true);
  expect(result).toBe("ab");
});
