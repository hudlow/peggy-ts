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

  export function padEnd(str: string, targetLength: number, padString: string) {
    padString = padString || " ";
    if (str.length > targetLength) { return str; }
    targetLength -= str.length;
    padString += padString.repeat(targetLength);
    return str + padString.slice(0, targetLength);
  }

  export interface SourceText {
    source: any;
    text: string;
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
      .replace(/[\x00-\x0F]/g, function (ch) {
        return "\\x0" + hex(ch);
      })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function (ch) {
        return "\\x" + hex(ch);
      });
 }

  export class ParseFailure {
  }

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
      if (["\n", "\r"].includes(input[i-1])) {
        break;
      }

      column++;
    }

    return column;
  }

  export function getLocation(source: string | GrammarLocation | undefined, input: string, start: string, remainder: string): runtime.LocationRange {
    return {
      source,
      start: {
        offset: input.length - start.length,
        line: getLine(input, input.length - start.length),
        column: getColumn(input, input.length - start.length)
      },
      end: {
        offset: input.length - remainder.length,
        line: getLine(input, input.length - remainder.length),
        column: getColumn(input, input.length - remainder.length)
      },
    }
  }

  export function getRange(source: string | GrammarLocation | undefined, input: string, start: string, remainder: string) {
    return {
      source,
      start: input.length - start.length,
      end: input.length - remainder.length
    }
  }

  export function getText(start: string, remainder: string) {
    return start.slice(0, remainder.length > 0 ? -remainder.length : undefined)
  }
}

export class SyntaxError extends Error {
  expected: runtime.Expectation[];
  found: string | null;
  location: runtime.LocationRange;

  constructor(
    expected: runtime.Expectation[],
    found: string | null,
    location: runtime.LocationRange,
  ) {
    super(SyntaxError.formatMessage(expected, found));
    this.name = "SyntaxError";
    this.expected = expected;
    this.found = found;
    this.location = location;
  }

  static formatMessage(expected: runtime.Expectation[], found: string | null): string {
    function describeExpected(expected: runtime.Expectation[]): string {
      const descriptions = expected.map(e => e.value);
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
            ", or " +
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

  format = (sources: runtime.SourceText[]) => {
    var str = "Error: " + this.message;

    if (this.location) {
      var src = null;
      var k;
      for (k = 0; k < sources.length; k++) {
        if (sources[k].source === this.location.source) {
          src = sources[k].text.split(/\r\n|\n|\r/g);
          break;
        }
      }
      var s = this.location.start;
      var offset_s = (this.location.source instanceof runtime.GrammarLocation)
        ? this.location.source.offset(s)
        : s;
      var loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
      if (src) {
        var e = this.location.end;
        var filler = runtime.padEnd("", offset_s.line.toString().length, ' ');
        var line = src[s.line - 1];
        var last = s.line === e.line ? e.column : line.length + 1;
        var hatLen = (last - s.column) || 1;
        str += "\n --> " + loc + "\n"
            + filler + " |\n"
            + offset_s.line + " | " + line + "\n"
            + filler + " | " + runtime.padEnd("", s.column - 1, ' ')
            + runtime.padEnd("", hatLen, "^");
      } else {
        str += "\n at " + loc;
      }
    }
    return str;
  }
}
