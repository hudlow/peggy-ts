namespace runtime {
  export interface Location {
    line: number;
    column: number;
    offset: number;
  }
  export interface LocationRange {
    source: string | GrammarLocation;
    start: Location;
    end: Location;
  }
  export interface Range {
    source: string | GrammarLocation;
    start: number;
    end: number;
  }
  export class GrammarLocation {
    source: string | GrammarLocation;
    start: Location;
    constructor(source: string | GrammarLocation, start: Location) {
      this.source = source;
      this.start = start;
    }
    toString(): string {
      return String(this.source);
    }
    offset(loc: Location): Location {
      return {
        line: loc.line + this.start.line - 1,
        column: (loc.line === 1)
          ? loc.column + this.start.column - 1
          : loc.column,
        offset: loc.offset + this.start.offset,
      };
    }
    static offsetStart(range: LocationRange): Location {
      if (range.source instanceof GrammarLocation) {
        return range.source.offset(range.start);
      }
      return range.start;
    }
    static offsetEnd(range: LocationRange): Location {
      if (range.source instanceof GrammarLocation) {
        return range.source.offset(range.end);
      }
      return range.end;
    }
  }
  export class ParserSyntaxError extends Error {
    expected: Expectation[];
    found: string | null;
    location: LocationRange;
    constructor(
      expected: Expectation[],
      found: string | null,
      location: LocationRange,
    ) {
      super(ParserSyntaxError.formatMessage(expected, found));
      this.expected = expected;
      this.found = found;
      this.location = location;
    }
    static formatMessage(expected: Expectation[], found: string | null): string {
      function describeExpected(expected: Expectation[]): string {
        const descriptions = expected.map(String);
        descriptions.sort();
        if (descriptions.length > 0) {
          let j = 1;
          for (let i = 1; i < descriptions.length; i++) {
            if (descriptions[i - 1] !== descriptions[i]) {
              descriptions[j] = descriptions[i];
              j++;
            }
          }
          descriptions.length = j;
        }
        switch (descriptions.length) {
          case 1:
            return descriptions[0];
          case 2:
            return descriptions[0] + " or " + descriptions[1];
          default:
            return descriptions.slice(0, -1).join(", ") +
              ", or" +
              descriptions[descriptions.length - 1];
        }
      }
      function describeFound(found: string | null): string {
        return found
          ? '"' + escape(found) + '"'
          : "end of input";
      }
      return "Expected " + describeExpected(expected) + " but " +
        describeFound(found) + " found.";
    }
  }
  function hex(ch: string): string {
    return ch.charCodeAt(0).toString(16).toUpperCase();
  }
  export interface Expectation {
    type: "literal" | "class" | "any" | "end" | "pattern" | "other";
    value: string;
  }
  function escape(s: string): string {
    return s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\0/g, "\\0")
      .replace(/\t/g, "\\t")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/[\x00-\x0F]/g, function(ch) {
        return "\\x0" + hex(ch);
      })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) {
        return "\\x" + hex(ch);
      });
  }
  export class ParseFailure {
  }
  export class ParseOptions {
    currentPosition: number = 0;
    silentFails: number = 0;
    maxFailExpected: Expectation[] = [];
    grammarSource: string | GrammarLocation = "";
    library: boolean = false;
    startRule?: string;
    [index: string]: unknown;
  }
  export type Result<T> = Failure | Success<T>;
  export interface Failure {
    success: false;
    expectations: Expectation[];
    remainder: string;
  }
  export interface Success<T> {
    success: true;
    value: T;
    remainder: string;
  }
  export function isFailure(r: Result<unknown>): r is Failure {
    return !r.success;
  }
  function getLine(input: string, offset: number) {
    let line = 1;
    for (let i = 0; i < offset; i++) {
      if (input[i] === "\r") {
        if (input[i + 1] === "\n") {
          i++;
        }
        line++;
      } else if (input[i] === "\n") {
        line++;
      }
    }
    return line;
  }
  function getColumn(input: string, offset: number) {
    let column = 1;
    for (let i = offset; i > 0; i--) {
      if (["\n", "\r"].includes(input[i - 1])) {
        break;
      }
      column++;
    }
    return column;
  }
  export function getLocation(source: string | GrammarLocation, input: string, start: string, remainder: string): runtime.LocationRange {
    return {
      source,
      start: {
        offset: input.length - start.length,
        line: getLine(input, start.length),
        column: getColumn(input, start.length)
      },
      end: {
        offset: input.length - remainder.length,
        line: getLine(input, remainder.length),
        column: getColumn(input, remainder.length)
      },
    }
  }
  export function getRange(source: string | GrammarLocation, input: string, start: string, remainder: string) {
    return {
      source,
      start: input.length - start.length,
      end: input.length - remainder.length
    }
  }
  export function getText(start: string, remainder: string) {
    return start.slice(0, -remainder.length)
  }
}
const item2: runtime.Expectation = {
  type: "any",
  value: "any character"
}
const item8: runtime.Expectation = {
  type: "pattern",
  value: "/^[0-9]/"
}
const item13: runtime.Expectation = {
  type: "literal",
  value: "hello"
}
const item16: runtime.Expectation = {
  type: "literal",
  value: " "
}
const item22: runtime.Expectation = {
  type: "literal",
  value: "world"
}
const item25: runtime.Expectation = {
  type: "end",
  value: "end of input"
}
export function parse(input: string, options: runtime.ParseOptions = new runtime.ParseOptions()): (string)[] | any {
  const parse$lines = input.split(/\r\n|\r|\n/);
  const parse$totalLength = input.length;
  const parse$source = options.grammarSource;
  const result = item1(input);
  if (result.success === true) {
    return result.value;
  } else {
    throw new Error("expected:\n* " + result.expectations.map(e => e.value).join("\n* ") + "\n\nremainder:\n" + result.remainder);
  }
  type item24 = ["hello", " ", any
  ]
  function item23(
    location: () => runtime.LocationRange,
    range: () => runtime.Range,
    text: () => string,
    offset: () => number,
    error: (s: string, l?: runtime.LocationRange) => void,
    foo: "world"
  ) {
    return options;
  }
  function item1(text: string): runtime.Success<(string)[] | any> | runtime.Failure {
    const result = item4(text);
    if (result.success) {
      if (result.remainder.length === 0) {
        return result;
      } else {
        return {
          success: false,
          expectations: [item25],
          remainder: result.remainder
        };
      }
      ;
    } else {
      return result as runtime.Failure;
    }
  }
  // a / b
  function item4(text: string): runtime.Success<(string)[] | any> | runtime.Failure {
    const choices = [item6, item10];
    const expectations: runtime.Expectation[] = [];
    for (let func = choices.shift(); func !== undefined; func = choices.shift()) {
      const result = func(text);
      if (result.success === true) {
        return result;
      } else {
        expectations.push(...result.expectations)
      }
    }
    return {
      success: false,
      expectations: [...new Set(expectations)],
      remainder: text
    };
  }
  // [0-9]+
  function item6(text: string): runtime.Success<(string)[]> | runtime.Failure {
    const results: Array<string> = [];
    let r = text;
    let result;
    do {
      result = item7(r);
      if (result.success === true) {
        r = result.remainder;
        results.push(result.value);
      }
    } while (
      result.success); if (results.length < 1) {
        // the loop above guarantees this will be a failure
        return result as runtime.Failure;
      } else {
      return { success: true, value: results, remainder: r };
    }
  }
  // [0-9]
  function item7(text: string): runtime.Success<string> | runtime.Failure {
    if (/^[0-9]/.test(text)) {
      return {
        success: true,
        value: text.slice(0, 1
        ),
        remainder: text.slice(1
        )
      };
    } else {
      return {
        success: false,
        expectations: [item8],
        remainder: text
      };
    }
  }
  // c s @d
  function item10(text: string): runtime.Success<any> | runtime.Failure {
    const result = (() => {
      let remainder = text;
      const result0 = item12(remainder);
      if (runtime.isFailure(result0)) {
        return result0;
      } else {
        remainder = result0.remainder;
      }
      const result1 = item15(remainder);
      if (runtime.isFailure(result1)) {
        return result1;
      } else {
        remainder = result1.remainder;
      }
      const result2 = item19(remainder);
      if (runtime.isFailure(result2)) {
        return result2;
      } else {
        remainder = result2.remainder;
      }
      const value: item24 = [
        result0.value, result1.value, result2.value
      ]
      return {
        success: true,
        value,
        remainder
      }
    })();
    if (result.success) {
      return {
        success: true,
        value: result.value[2],
        remainder: result.remainder
      };
    } else {
      return result as runtime.Failure;
    }
  }
  // "hello"
  function item12(text: string): runtime.Success<"hello"> | runtime.Failure {
    if (text.startsWith("hello")) {
      return {
        success: true,
        value: "hello",
        remainder: text.slice(5
        )
      };
    } else {
      return {
        success: false,
        expectations: [item13],
        remainder: text
      };
    }
  }
  // " "
  function item15(text: string): runtime.Success<" "> | runtime.Failure {
    if (text.startsWith(" ")) {
      return {
        success: true,
        value: " ",
        remainder: text.slice(1
        )
      };
    } else {
      return {
        success: false,
        expectations: [item16],
        remainder: text
      };
    }
  }
  // foo:"world" { return options; }
  function item19(text: string): runtime.Success<any> | runtime.Failure {
    const result = item21(text);
    if (result.success) {
      return {
        success: true,
        value: item23(
          () => runtime.getLocation(parse$source, input, text, result.remainder),
          () => runtime.getRange(parse$source, input, text, result.remainder),
          () => runtime.getText(text, result.remainder),
          () => (input.length - text.length),
          (
            message: string,
            location: runtime.LocationRange = runtime.getLocation(parse$source, input, text, result.remainder)
          ) => {
            throw new Error("Error at " + location.source + ":" + location.start.line + ":" + location.start.column + ": " + message)
          },
          result.value
        ),
        remainder: result.remainder
      };
    } else {
      return result as runtime.Failure;
    }
  }
  // "world"
  function item21(text: string): runtime.Success<"world"> | runtime.Failure {
    if (text.startsWith("world")) {
      return {
        success: true,
        value: "world",
        remainder: text.slice(5
        )
      };
    } else {
      return {
        success: false,
        expectations: [item22],
        remainder: text
      };
    }
  }
}
