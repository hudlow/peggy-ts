namespace runtime {
  export interface Location {
    line: number;
    column: number;
    offset: number;
  }

  export interface LocationRange {
    source?: string | GrammarLocation;
    start: Location;
    end: Location;
  }

  export interface Range {
    source?: string | GrammarLocation;
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
        column:
          loc.line === 1 ? loc.column + this.start.column - 1 : loc.column,
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

  export function padEnd(str: string, targetLength: number, padString: string) {
    padString = padString || " ";
    if (str.length > targetLength) {
      return str;
    }
    targetLength -= str.length;
    padString += padString.repeat(targetLength);
    return str + padString.slice(0, targetLength);
  }

  export interface SourceText {
    source: any;
    text: string;
  }

  export interface Expectation {
    type: "literal" | "class" | "any" | "end" | "pattern" | "other";
    value: string;
  }

  export class ParseFailure {}

  export class ParseOptions {
    currentPosition?: number;
    silentFails?: number;
    maxFailExpected?: Expectation[];
    grammarSource?: string | GrammarLocation;
    library?: boolean;
    startRule?: string;
    [index: string]: unknown;
  }

  export type Result<T> = Failure | Success<T>;

  export interface Failure {
    success: false;
    remainder: string;
    failedExpectations: FailedExpectation[];
  }

  export interface Success<T> {
    success: true;
    value: T;
    remainder: string;
    failedExpectations: FailedExpectation[];
  }

  export interface FailedExpectation {
    expectation: Expectation;
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

  export function getLocation(
    source: string | GrammarLocation | undefined,
    input: string,
    start: string,
    remainder: string,
  ): runtime.LocationRange {
    return {
      source,
      start: {
        offset: input.length - start.length,
        line: getLine(input, input.length - start.length),
        column: getColumn(input, input.length - start.length),
      },
      end: {
        offset: input.length - remainder.length,
        line: getLine(input, input.length - remainder.length),
        column: getColumn(input, input.length - remainder.length),
      },
    };
  }

  export function getRange(
    source: string | GrammarLocation | undefined,
    input: string,
    start: string,
    remainder: string,
  ) {
    return {
      source,
      start: input.length - start.length,
      end: input.length - remainder.length,
    };
  }

  export function getText(start: string, remainder: string) {
    return start.slice(0, remainder.length > 0 ? -remainder.length : undefined);
  }
}

export class ParseError extends Error {
  rawMessage: string;
  location: runtime.LocationRange;

  constructor(
    message: string,
    location: runtime.LocationRange,
    name: string = "parse error",
  ) {
    super(ParseError.#formatMessage(message, location));
    this.name = name;
    this.rawMessage = message;
    this.location = location;
  }

  static #formatMessage(message: string, location: runtime.LocationRange) {
    const source =
      location.source !== undefined ? String(location.source) : "<input>";

    return (
      `${source}:${location.start.line}:${location.start.column}: ` + message
    );
  }
}

export class SyntaxError extends ParseError {
  expected: runtime.Expectation[];
  found: string | null;

  constructor(
    expected: runtime.Expectation[],
    found: string,
    location: runtime.LocationRange,
    name: string = "syntax error",
  ) {
    super(SyntaxError.#formatMessage(expected, found), location, name);
    this.expected = expected;
    this.found = found;
  }

  static #formatMessage(
    expected: runtime.Expectation[],
    found: string,
  ): string {
    function encode(s: string): string {
      return (
        "'" +
        s.replace(/[\\\x07\b\f\n\r\t\v']/g, (match) => {
          switch (match) {
            case "\\":
              return "\\\\";
            case "\x07":
              return "\\x07";
            case "\b":
              return "\\b";
            case "\f":
              return "\\f";
            case "\n":
              return "\\n";
            case "\r":
              return "\\r";
            case "\t":
              return "\\t";
            case "\v":
              return "\\v";
            case "'":
              return "\\'";
            default:
              throw new Error(
                "Unexpected string encoding replacement character. This should be an unreachable error.",
              );
          }
        }) +
        "'"
      );
    }

    function describeExpected(expected: runtime.Expectation[]): string {
      const descriptions = [
        ...new Set(
          expected.map((e) => {
            if (e.type === "literal") {
              return encode(e.value);
            }

            return e.value;
          }),
        ),
      ];

      descriptions.sort();

      switch (descriptions.length) {
        case 1:
          return descriptions[0];
        case 2:
          return `${descriptions[0]} or ${descriptions[1]}`;
        default:
          return (
            descriptions.slice(0, -1).join(", ") +
            ", or " +
            descriptions[descriptions.length - 1]
          );
      }
    }

    function describeFound(found: string): string {
      return found.length === 1 ? found : "end of input";
    }

    return (
      "found " +
      describeFound(found) +
      " but expecting " +
      describeExpected(expected)
    );
  }
}
