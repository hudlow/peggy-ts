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

import fs from "node:fs";

import * as Peggy from "peggy";
import * as Morph from "ts-morph";
import { SourceNode } from "source-map-generator";

import runtime from "./library/runtime.ts";
import inferReturnType from "./library/infer-return-type.ts";
import compile from "./library/compile.ts";

export function use(config: Peggy.Config, options: Peggy.ParserBuildOptions) {
  config.passes.generate = [
    (...args) => {
      return toTypeScript(...args);
    },
  ];
}

function toTypeScript(
  grammar: Peggy.ast.Grammar,
  options: Peggy.ParserBuildOptions,
  session: Peggy.Session,
) {
  let rawSource: string | undefined;

  if (grammar.location.source?.length === grammar.location.end.offset) {
    // probably the actual source for the grammar
    rawSource = grammar.location.source;
  } else if (
    typeof grammar.location.source === "string" &&
    grammar.location.source.indexOf(" ") == -1 &&
    grammar.location.source.length <= 1024
  ) {
    // probably the file path for the source
    try {
      let source = fs.readFileSync(grammar.location.source, {
        encoding: "utf8",
      });

      if (source.length === grammar.location.end.offset) {
        rawSource = source;
      }
    } catch (error) {
      // no source loaded
    }
  }

  function getHeaderCode(): string {
    if (Array.isArray(grammar.topLevelInitializer)) {
      return grammar.topLevelInitializer.map((i) => i.code).join("\n");
    } else if (grammar.topLevelInitializer?.code !== undefined) {
      return grammar.topLevelInitializer.code;
    } else {
      return "";
    }
  }

  function hex(character: string) {
    return character.charCodeAt(0).toString(16).toUpperCase();
  }

  interface Node {
    toCode(): string;
    toType(): Type;
  }

  interface ResultNode extends Node {
    toType(): ResultType;
  }

  interface ReturnNode extends Node {
    toReturnCode(): string;
  }

  function isReturnNode(n: Node): n is ReturnNode {
    return typeof (n as ReturnNode).toReturnCode === "function";
  }

  class Value implements Node {
    readonly arg: Argument;
    readonly value: Node;

    constructor(arg: Argument, value: Node) {
      this.arg = arg;
      this.value = value;
    }

    toCode() {
      return this.value.toCode();
    }

    toType() {
      return this.value.toType();
    }
  }

  abstract class Reusable implements Node {
    name: string;
    static #directory: Reusable[] = [];

    abstract toDefinition(): string;
    abstract toCode(): string;
    abstract toType(): Type;

    static getDirectory() {
      return [...this.#directory];
    }

    static filter(criteria: (r: Reusable) => boolean): Reusable[] {
      return Reusable.#directory.filter(criteria);
    }

    static find(criteria: (r: Reusable) => boolean): Reusable | undefined {
      return Reusable.#directory.find(criteria);
    }

    static push(reusable: Reusable) {
      return Reusable.#directory.push(reusable);
    }

    constructor() {
      this.name = `item${Reusable.push(this)}`;
    }
  }

  class Code extends Reusable {
    action: Peggy.ast.Action;
    values: Value[];
    type: Type;
    input: Node;
    remainder: Node;

    private constructor(
      action: Peggy.ast.Action,
      values: Value[],
      input: Node,
      remainder: Node,
    ) {
      super();

      this.action = action;
      this.values = values;
      this.type = new NoType();
      this.input = input;
      this.remainder = remainder;

      const typeMatch = this.action.code.match(/^\s*\/\*\s*:(.+)\*\//);

      if (typeMatch !== null) {
        this.type = SimpleType.from((typeMatch[1] as string).trim());
      } else {
        this.type = SimpleType.from(
          inferReturnType(
            Reusable.getDirectory()
              .map((r) => r.toDefinition())
              .join("\n"),
            this.name,
            getHeaderCode(),
            options.additionalFiles,
          ),
        );
      }
    }

    static from(
      action: Peggy.ast.Action,
      values: Value[],
      input: Node,
      remainder: Node,
    ) {
      const found = Reusable.find(
        (c) => c instanceof Code && c.action === action,
      );

      if (found !== undefined) {
        return found as Code;
      } else {
        return new Code(action, values, input, remainder);
      }
    }

    toDefinition(): string {
      return `
        function ${this.name}(
          location: () => runtime.LocationRange,
          range: () => runtime.Range,
          text: () => string,
          offset: () => number,
          error: (s: string, l?: runtime.LocationRange) => void,
          ${this.values.map((v) => v.arg.toDefinition()).join()}
        )${this.type.toAnnotation()}
        {
          ${this.action.code}
        }
      `;
    }

    toCode(): string {
      return `${this.name}(
        () => runtime.getLocation(parse$source, input, ${this.input.toCode()}, ${this.remainder.toCode()}),
        () => runtime.getRange(parse$source, input, ${this.input.toCode()}, ${this.remainder.toCode()}),
        () => runtime.getText(${this.input.toCode()}, ${this.remainder.toCode()}),
        () => (input.length - ${this.input.toCode()}.length),
        (
          message: string,
          location = runtime.getLocation(parse$source, input, ${this.input.toCode()}, ${this.remainder.toCode()})
        ) => {
          throw new Error("Error at " + location.source + ":" + location.start.line + ":" + location.start.column + ": " + message)
        },
        ${this.values.map((v) => v.toCode()).join()}
      )`;
    }

    toType(): Type {
      return this.type;
    }
  }

  class Argument implements Node {
    name: string;
    type: Type;

    constructor(name: string, type: Type) {
      this.name = name;
      this.type = type;
    }

    toDefinition() {
      return `${this.name}${this.type.toAnnotation()}`;
    }

    toCode() {
      return this.name;
    }

    toType() {
      return this.type;
    }
  }

  class IndexedArgument extends Argument {
    index: number;

    constructor(name: string, type: Type, index: number) {
      super(name, type);

      this.index = index;
    }
  }

  type Origin =
    | Peggy.ast.Grammar
    | Peggy.ast.Expression
    | Peggy.ast.Rule
    | Peggy.ast.Named;
  type Source = PEG.LocationRange;

  class NoType implements Type {
    toConcrete(): Type {
      return this;
    }

    toCode(): string {
      return "any";
    }

    toAnnotation(): string {
      return "";
    }

    toType(): Type {
      throw new Error("no type set");
    }

    propertyType(p: Stringy): Type {
      throw new Error("no type set");
    }

    check(value: Node): Node {
      throw new Error("no type set");
    }

    unwrap(): Type {
      return this;
    }
  }

  class Function extends Reusable {
    args: [Argument] = [new Argument("text", SimpleType.from("string"))];

    body: Return = new Return(
      new Failure(
        [Expectation.from("any", "any character")],
        StringLiteral.from(),
      ),
    );
    header: Comment | Empty = new Empty();
    returnType: ResultType | NoType;

    expectations: Expectation[] = [];

    readonly source: Source;

    constructor(source: Source) {
      super();
      this.source = source;
      this.returnType = new NoType();

      if (rawSource !== undefined) {
        this.header = new Comment(
          rawSource.slice(source.start.offset, source.end.offset),
        );
      }
    }

    setBody(body: Return): void {
      this.body = body;
      this.returnType = body.toType();
    }

    getArguments() {
      return this.args;
    }

    toCode(): string {
      return this.name;
    }

    toLabel(): string | boolean {
      return false;
    }

    toDefinition(initializer?: Node): string {
      const args = this.args.map((a) => a.toDefinition()).join(", ");
      const subFuncs: Function[] = [];

      const body = `
        ${subFuncs.map((f) => f.toDefinition()).join("")}

        ${this.body.toCode()}
      `;

      return `
        ${this.header.toCode()}
        function ${this.name}(${args})${this.returnType.toAnnotation()} {
          ${initializer !== undefined ? initializer.toCode() : ""}

          ${body}
        }
      `;
    }

    static from(origin: Origin): Function {
      const found = Reusable.find(
        (f) => f instanceof Function && f.source === origin.location,
      );

      if (found !== undefined) {
        return found as Function;
      }

      if (origin.type === "rule") {
        return new Rule(origin);
      } else if (origin.type === "choice") {
        return new Choice(origin);
      } else if (origin.type === "sequence") {
        return new Sequence(origin);
      } else if (origin.type === "rule_ref") {
        const foundOrigin = grammar.rules.find((r) => r.name === origin.name);

        if (foundOrigin !== undefined) {
          return Function.from(foundOrigin);
        } else {
          throw new Error(`bad rule reference: ${origin.name}`);
        }
      } else if (origin.type === "labeled") {
        if (origin.label === null) {
          return new Pick(origin);
        } else {
          return new Label(origin);
        }
      } else if (origin.type === "action") {
        return new Action(origin);
      } else if (origin.type === "literal") {
        return new Literal(origin);
      } else if (origin.type === "optional") {
        return new Optional(origin);
      } else if (origin.type === "simple_not") {
        return new SimpleNot(origin);
      } else if (origin.type === "zero_or_more") {
        return new ZeroOrMore(origin);
      } else if (origin.type === "one_or_more") {
        return new OneOrMore(origin);
      } else if (origin.type === "repeated") {
        return new Repeated(origin);
      } else if (origin.type === "any") {
        return new Any(origin);
      } else if (origin.type === "class") {
        return new Class(origin);
      } else if (origin.type === "text") {
        return new Text(origin);
      } else if (origin.type === "named") {
        return Named.from(origin.expression);
      } else if (origin.type === "group") {
        return Function.from(origin.expression);
      }

      const func = new Function(origin.location);

      throw new Error(`Unknown node type: ${origin.type}`);

      func.setBody(
        new Return(
          new Success(StringLiteral.from("success"), StringLiteral.from()),
        ),
      );

      return func;
    }

    toType(): Type {
      throw new Error("function types not supported");
    }
  }

  class Repetition implements ResultNode {
    func: Function;
    remainder: Argument;
    min?: number | string;
    max?: number | string;
    delimiter?: Function;

    constructor(
      func: Function,
      remainder: Argument,
      min?: number | string,
      max?: number | string,
      delimiter?: Function,
    ) {
      this.func = func;
      this.remainder = remainder;
      this.min = min !== null ? min : undefined;
      this.max = max !== null ? max : undefined;
      this.delimiter = delimiter;
    }

    toType(): ResultType {
      return UnionType.from(
        SuccessType.from(
          ArrayType.from(ReturnType.from(this.func).unwrap()),
        ) as SuccessType | FailureType,
        FailureType.singleton,
      );
    }

    toCode(): string {
      return `(() => {${this.toReturnCode()}})()`;
    }

    toReturnCode(): string {
      return `
        const values: Array<${this.func.returnType.unwrap().toCode()}> = [];
        let remainder = ${this.remainder.toCode()};
        let result;

        do {
          let r = remainder;
          ${
            this.delimiter
              ? `
              if (values.length > 0) {
                result = ${this.delimiter.toCode()}(r);

                if (result.success === false) {
                  break;
                }

                r = result.remainder;
              }`
              : ``
          }

          result = ${this.func.toCode()}(r);
          if (result.success === false) {
            break;
          }

          remainder = result.remainder;
          values.push(result.value);
        } while (${this.max !== undefined ? `values.length <= ${this.max}` : `true`});

        ${
          this.min
            ? `if (values.length < ${this.min} && result.success === false /* technically redundant */) {
              return result;
            } else {
              return { success: true, value: values, remainder };
            }`
            : `return { success: true, value: values, remainder };`
        }`;
    }
  }

  class OneOrMore extends Function {
    constructor(suffixed: Peggy.ast.Suffixed) {
      super(suffixed.location);

      this.setBody(
        new Return(
          new Repetition(Function.from(suffixed.expression), this.args[0], 1),
        ),
      );
    }
  }

  class ZeroOrMore extends Function {
    constructor(suffixed: Peggy.ast.Suffixed) {
      super(suffixed.location);

      this.setBody(
        new Return(
          new Repetition(Function.from(suffixed.expression), this.args[0], 0),
        ),
      );
    }
  }

  class Repeated extends Function {
    constructor(repeated: Peggy.ast.Repeated) {
      super(repeated.location);

      this.setBody(
        new Return(
          new Repetition(
            Function.from(repeated.expression),
            this.args[0],
            repeated.min !== null ? repeated.min?.value : repeated.max?.value,
            repeated.max?.value,
            repeated.delimiter !== null
              ? Function.from(repeated.delimiter)
              : undefined,
          ),
        ),
      );
    }
  }

  class Optional extends Function {
    constructor(optional: Peggy.ast.Suffixed) {
      super(optional.location);

      this.setBody(
        new Return(
          new Attempt(
            new Invocation(Function.from(optional.expression), this.args),
            undefined,
            (f) => new Success(new NullLiteral(), this.args[0]),
          ),
        ),
      );
    }
  }

  interface Stringy {
    toString(): string;
  }

  interface Type extends Node {
    toConcrete(): Type;
    toCode(): string;
    toAnnotation(): string;
    toType(): Type;
    propertyType(p: Stringy): Type;
    check(value: Node): Node;
  }

  class SimpleType implements Type {
    readonly value: string;

    static #directory: SimpleType[] = [];

    private constructor(value: string) {
      this.value = value;

      SimpleType.#directory.push(this);
    }

    static from(value: string): Type {
      if (value === "any") {
        return new NoType();
      }

      const found = SimpleType.#directory.find((t) => t.value === value);

      if (found !== undefined) {
        return found;
      } else {
        return new SimpleType(value);
      }
    }

    toConcrete(): Type {
      return this;
    }

    toCode(): string {
      return this.value;
    }

    toAnnotation(): string {
      return `: ${this.value}`;
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    propertyType(p: Stringy): Type {
      throw new Error("unknown property type");
    }

    check(value: Node): Node {
      return new TypeOf(value, this);
    }
  }

  class LiteralType implements Type {
    value: LiteralNode;

    static #directory: LiteralType[] = [];

    private constructor(value: LiteralNode) {
      this.value = value;

      LiteralType.#directory.push(this);
    }

    static from(value: LiteralNode) {
      const found = LiteralType.#directory.find((t) => t.value === value);

      if (found !== undefined) {
        return found;
      } else {
        return new LiteralType(value);
      }
    }

    toConcrete(): Type {
      return this;
    }

    toCode(): string {
      return this.value.toCode();
    }

    toAnnotation(): string {
      return `: ${this.toCode()}`;
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    propertyType(p: Stringy): Type {
      throw new Error("unknown property type");
    }

    check(value: Node): Node {
      return new Equals(value, this.value);
    }
  }

  class Equals implements Node {
    left: Node;
    right: Node;

    constructor(left: Node, right: Node) {
      this.left = left;
      this.right = right;
    }

    toCode(): string {
      return `${this.left.toCode()} === ${this.right.toCode()}`;
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class TypeOf implements Node {
    value: Node;
    type: Type;

    constructor(value: Node, type: Type) {
      this.value = value;
      this.type = type;
    }

    toCode() {
      return `typeof ${this.value.toCode()} === "${this.type.toCode()}"`;
    }

    toType() {
      return SimpleType.from("boolean");
    }
  }

  type ResultType =
    | ReturnType
    | SuccessType
    | FailureType
    | UnionType<SuccessType | FailureType | ResultType>;

  class FailureType implements Type {
    readonly type = SimpleType.from("runtime.Failure");

    static readonly singleton = new FailureType();

    private constructor() {}

    toConcrete(): Type {
      return this;
    }

    toCode(): string {
      return this.type.toCode();
    }

    toAnnotation(): string {
      return this.type.toAnnotation();
    }

    unwrap(): Type {
      throw new Error("cannot unwrap failure type");
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    propertyType(p: Stringy): Type {
      throw new Error("unknown property type");
    }

    check(value: Node): Node {
      return new InstanceOf(value, this);
    }

    static check(value: Node): Node {
      return new Not(new Access(value, StringLiteral.from("success")));
    }
  }

  class SuccessType implements Type {
    static readonly type: Type = SimpleType.from("runtime.Success");
    readonly subtype: Type;

    static #directory: SuccessType[] = [];

    constructor(subtype: Type) {
      this.subtype = subtype;

      SuccessType.#directory.push(this);
    }

    static from(subtype: Type): SuccessType {
      const found = SuccessType.#directory.find((g) => g.subtype === subtype);

      if (found !== undefined) {
        return found;
      } else {
        return new SuccessType(subtype);
      }
    }

    toConcrete(): Type {
      return this;
    }

    toCode(): string {
      return `${SuccessType.type.toCode()}<${this.subtype.toCode()}>`;
    }

    toAnnotation(): string {
      if (this.subtype instanceof NoType) {
        return "";
      } else {
        return `: ${this.toCode()}`;
      }
    }

    unwrap(): Type {
      return this.subtype;
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    propertyType(p: Stringy): Type {
      throw new Error("unknown property type");
    }

    check(value: Node): Node {
      return new InstanceOf(value, this);
    }

    static check(value: Node): Node {
      return new Access(value, StringLiteral.from("success"));
    }
  }

  class ArrayType implements Type {
    readonly type: Type;

    static #directory: ArrayType[] = [];

    private constructor(type: Type) {
      this.type = type;

      ArrayType.#directory.push(this);
    }

    static from(type: Type): ArrayType {
      const found = ArrayType.#directory.find((t) => t.type === type);

      if (found !== undefined) {
        return found;
      } else {
        return new ArrayType(type);
      }
    }

    toConcrete(): Type {
      return this;
    }

    toCode(): string {
      return `(${this.type.toCode()})[]`;
    }

    toAnnotation(): string {
      if (this.type instanceof NoType) {
        return "";
      } else {
        return `: ${this.toCode()}`;
      }
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    propertyType(p: Stringy): Type {
      throw new Error("unknown property type");
    }

    check(value: Node): Node {
      throw new Error("cannot type check array");
    }
  }

  class UnionType<T extends Exclude<Type, UnionType<Type>>> implements Type {
    readonly types: T[];

    static #directory: UnionType<Type>[] = [];

    private constructor(...types: T[]) {
      this.types = types;

      UnionType.#directory.push(this);
    }

    static from<S extends Type>(
      ...rawTypes: (S | UnionType<S>)[]
    ): S | UnionType<S> {
      const types = rawTypes
        .reduce((accumulated, type) => {
          if (type instanceof UnionType) {
            return [...new Set([...accumulated, ...type.types])];
          } else {
            return [...new Set([...accumulated, type])];
          }
        }, [] as S[])
        .reduce((accumulated, type) => {
          if (type instanceof SuccessType) {
            if (
              accumulated.length > 0 &&
              accumulated[0] instanceof SuccessType
            ) {
              return [
                SuccessType.from(
                  UnionType.from(accumulated[0].unwrap(), type.unwrap()),
                ) as unknown as S,
                ...accumulated.slice(1),
              ];
            } else {
              return [type, ...accumulated];
            }
          } else {
            return [...accumulated, type];
          }
        }, [] as S[]);

      if (types.length === 0) {
        throw new Error("cannot create union of zero types");
      } else if (types.length === 1) {
        return types[0] as S;
      }

      const found = UnionType.#directory.find(
        (t) =>
          types.length === t.types.length &&
          types.reduce((r, type) => r && t.types.includes(type), true),
      ) as UnionType<S>;

      if (found !== undefined) {
        return found;
      } else {
        return new UnionType(...types);
      }
    }

    toConcrete(): Type {
      return this;
    }

    toCode(): string {
      const types = [...new Set(this.types.map((t) => t.toConcrete()))];

      if (types.some((t) => t instanceof UnionType)) {
        return UnionType.from(...types).toCode();
      } else {
        return `${types.map((t) => t.toCode()).join("|")}`;
      }
    }

    toAnnotation(): string {
      const types = [...new Set(this.types.map((t) => t.toConcrete()))];

      if (types.some((t) => t instanceof NoType)) {
        return "";
      } else {
        return `: ${this.toCode()}`;
      }
    }

    unwrap(): Type {
      const withoutFailure = this.types.filter(
        (t) => !(t instanceof FailureType),
      );

      if (
        withoutFailure.length === 1 &&
        withoutFailure[0] instanceof SuccessType
      ) {
        return withoutFailure[0].unwrap();
      } else {
        throw new Error("could not unwrap union type");
      }
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    propertyType(p: Stringy): Type {
      throw new Error("unknown property type");
    }

    check(value: Node): Node {
      throw new Error("cannot type check union");
    }
  }

  class Property {
    readonly type: Type;
    readonly label: string | boolean;

    static #directory: Property[] = [];

    private constructor(type: Type, label: string | boolean) {
      this.type = type;
      this.label = label;

      Property.#directory.push(this);
    }

    static from(type: Type, label: string | boolean): Property {
      const found = this.#directory.find(
        (p) => p.type === type && p.label === label,
      );

      if (found !== undefined) {
        return found;
      } else {
        return new Property(type, label);
      }
    }
  }

  class Raw implements Node {
    raw: string;

    constructor(raw: string) {
      this.raw = raw;
    }

    toCode(): string {
      return this.raw;
    }

    toType(): Type {
      throw new Error("cannot get type of raw node");
    }
  }

  class Interface extends Reusable implements Type {
    readonly properties: Property[];

    private constructor(properties: Property[]) {
      super();

      this.properties = properties;
    }

    static from(properties: Property[]): Interface {
      const found = Reusable.find(
        (i) =>
          i instanceof Interface &&
          i.properties.length === properties.length &&
          i.properties.reduce((r, p, i) => r && p === properties[i], true),
      );

      if (found !== undefined) {
        return found as Interface;
      } else {
        return new Interface(properties);
      }
    }

    toConcrete(): Type {
      return this;
    }

    toDefinition(): string {
      return (
        `
        type ${this.name} = [` +
        this.properties.map((p) => p.type.toCode()).join() +
        `]`
      );
    }

    toCode(): string {
      return this.name;
    }

    toAnnotation(): string {
      return `: ${this.toCode()}`;
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    toArguments(): IndexedArgument[] {
      const args: IndexedArgument[] = [];

      this.properties.forEach((p, i) => {
        if (typeof p.label === "string") {
          args.push(new IndexedArgument(p.label as string, p.type, i));
        }
      });

      return args;
    }

    propertyType(prop: Stringy): Type {
      const found = this.properties.find((p) => p.label === prop.toString());

      if (found !== undefined) {
        return found.type;
      } else {
        throw new Error(
          `cannot determine type of ${prop.toString()} property on interface ${this.name}`,
        );
      }
    }

    check(value: Node): Node {
      return new IsInterface(value, this);
    }
  }

  class IsInterface implements Node {
    value: Node;
    intf: Interface;

    constructor(value: Node, intf: Interface) {
      this.value = value;
      this.intf = intf;
    }

    toCode(): string {
      return `is${this.intf.name}(${this.value.toCode()})`;
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class Empty implements Node {
    toCode(): string {
      return "";
    }

    toType(): Type {
      return SimpleType.from("undefined");
    }
  }

  class Invocation implements ResultNode {
    func: Function;
    args: Node[];

    constructor(func: Function, args: Node[] = []) {
      this.args = args;
      this.func = func;
    }

    toCode(): string {
      return `${this.func.toCode().trim()}(${this.args
        .map((a) => a.toCode())
        .join(", ")})`;
    }

    toType(): ResultType {
      if (this.func.returnType instanceof NoType) {
        return ReturnType.from(this.func);
      }

      return this.func.returnType;
    }
  }

  class RawReturnTypeOf implements Node {
    value: Node;
    type: RawReturnType;

    constructor(value: Node, type: RawReturnType) {
      this.value = value;
      this.type = type;
    }

    toCode(): string {
      return this.type.type.func.returnType.unwrap().check(this.value).toCode();
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class RawReturnType implements Type {
    type: ReturnType;

    static #directory: RawReturnType[] = [];

    private constructor(type: ReturnType) {
      this.type = type;

      RawReturnType.#directory.push(this);
    }

    static from(type: ReturnType) {
      const found = RawReturnType.#directory.find((t) => t.type === type);

      if (found !== undefined) {
        return found;
      } else {
        return new RawReturnType(type);
      }
    }

    toConcrete(): Type {
      const unwrapped = this.type.func.returnType.unwrap();

      if (unwrapped instanceof UnionType) {
        return UnionType.from(...unwrapped.types.filter((t) => t !== this));
      } else {
        return unwrapped;
      }
    }

    toCode(): string {
      const unwrapped = this.type.func.returnType.unwrap();

      if (unwrapped instanceof UnionType) {
        return UnionType.from(
          ...unwrapped.types.filter((t) => t !== this),
        ).toCode();
      } else {
        return unwrapped.toCode();
      }
    }

    toAnnotation(): string {
      if (this.type.func.returnType instanceof NoType) {
        return "";
      } else {
        return `: ${this.toCode()}`;
      }
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    propertyType(prop: Stringy): Type {
      throw new Error("cannot get property type of return type");
    }

    check(value: Node): Node {
      return new RawReturnTypeOf(value, this);
    }
  }

  class ReturnTypeOf implements Node {
    value: Node;
    type: ReturnType;

    constructor(value: Node, type: ReturnType) {
      this.value = value;
      this.type = type;
    }

    toCode(): string {
      return this.type.func.returnType.check(this.value).toCode();
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class ReturnType implements Type {
    func: Function;

    static #directory: ReturnType[] = [];

    private constructor(func: Function) {
      this.func = func;

      ReturnType.#directory.push(this);
    }

    static from(func: Function) {
      if (func.returnType instanceof NoType) {
        const found = ReturnType.#directory.find((t) => t.func === func);

        if (found !== undefined) {
          return found;
        } else {
          return new ReturnType(func);
        }
      } else {
        return func.returnType;
      }
    }

    toConcrete(): Type {
      return this.func.returnType;
    }

    toCode(): string {
      return this.func.returnType.toCode();
    }

    toAnnotation(): string {
      if (this.func.returnType instanceof NoType) {
        return "";
      } else {
        return `: ${this.toCode()}`;
      }
    }

    toType(): Type {
      throw new Error("cannot get type of type");
    }

    unwrap(): Type {
      return RawReturnType.from(this);
    }

    propertyType(prop: Stringy): Type {
      throw new Error("cannot get property type of return type");
    }

    check(value: Node): Node {
      return new ReturnTypeOf(value, this);
    }
  }

  type Runner<N extends ResultNode> = (proxy: ResultProxy<N>) => ResultNode;

  class Antecedent<N extends ResultNode> implements ResultNode, ReturnNode {
    readonly proxy: ResultProxy<N>;
    readonly node: ResultNode;

    constructor(ante: N, runner: Runner<N>, index?: number) {
      this.proxy = new ResultProxy(ante, index);
      this.node = new Return(runner(this.proxy));
    }

    toCode(): string {
      return `(() => {
        ${this.toReturnCode()}
      })()`;
    }

    toReturnCode(): string {
      return `
        ${this.proxy.toDefinition()}

        ${
          isReturnNode(this.node)
            ? this.node.toReturnCode()
            : this.node.toCode()
        }
      `;
    }

    toType(): ResultType {
      return this.node.toType();
    }
  }

  class ResultProxy<N extends ResultNode> implements ResultNode {
    readonly name: string = "result";
    readonly node: N;

    constructor(node: N, index?: number) {
      this.node = node;

      if (index !== undefined) {
        this.name = `result${index}`;
      }
    }

    toCode(): string {
      return this.name;
    }

    toDefinition(): string {
      return `const ${this.name} = ${this.node.toCode()};`;
    }

    toType(): ResultType {
      return this.node.toType();
    }
  }

  type Identifierish = string | Identifier;

  class Identifier implements Node {
    #value: string;

    static #identifierCache: Identifier[] = [];

    private constructor(name: string) {
      this.#value = name;
      Identifier.#identifierCache.push(this);
    }

    static from(name: Identifierish): Identifier {
      if (name instanceof Identifier) {
        return name;
      } else {
        const found = Identifier.#identifierCache.find((i) => i.is(name));

        if (found !== undefined) {
          return found;
        } else {
          return new Identifier(name);
        }
      }
    }

    toCode(): string {
      return this.#value;
    }

    toType(): Type {
      throw new Error("unknown type");
    }

    is(name: Identifierish): boolean {
      if (name instanceof Identifier) {
        return this === name;
      } else {
        return this.#value === name;
      }
    }

    toString(): string {
      return this.#value;
    }
  }

  abstract class LiteralNode implements Node {
    abstract toCode(): string;
    abstract toType(): Type;

    static from(n: unknown): LiteralNode {
      if (n === undefined) {
        return new UndefinedLiteral();
      } else if (n === null) {
        return new NullLiteral();
      } else if (typeof n === "string") {
        return StringLiteral.from(n);
      } else if (typeof n === "boolean") {
        return new BooleanLiteral(n);
      } else if (typeof n === "number") {
        return new NumberLiteral(n);
      } else if (Array.isArray(n)) {
        return new ArrayLiteral(n.map((i: unknown) => LiteralNode.from(i)));
      }

      throw new Error("cannot convert to literal");
    }
  }

  class BooleanLiteral extends LiteralNode {
    value: boolean;

    constructor(value: boolean) {
      super();
      this.value = value;
    }

    toCode() {
      return this.value ? "true" : "false";
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class StringLiteral extends LiteralNode {
    readonly value: string;

    static #directory: StringLiteral[] = [];

    private constructor(value: string) {
      super();
      this.value = value;

      StringLiteral.#directory.push(this);
    }

    static from(value: string = ""): StringLiteral {
      const found = StringLiteral.#directory.find((s) => s.value === value);

      if (found !== undefined) {
        return found;
      } else {
        return new StringLiteral(value);
      }
    }

    toCode(includeDoubleQuotes: boolean = true) {
      if (includeDoubleQuotes) {
        return `"${this.escape()}"`;
      } else {
        return this.escape();
      }
    }

    toType(): Type {
      return LiteralType.from(this);
    }

    toString(): string {
      return this.value;
    }

    escape() {
      return this.value
        .replace(/\\/g, "\\\\") // Backslash
        .replace(/"/g, '\\"') // Closing double quote
        .replace(/\0/g, "\\0") // Null
        .replace(/\x08/g, "\\b") // Backspace
        .replace(/\t/g, "\\t") // Horizontal tab
        .replace(/\n/g, "\\n") // Line feed
        .replace(/\v/g, "\\v") // Vertical tab
        .replace(/\f/g, "\\f") // Form feed
        .replace(/\r/g, "\\r") // Carriage return
        .replace(/[\x00-\x0F]/g, (c) => "\\x0" + hex(c))
        .replace(/[\x10-\x1F\x7F-\xFF]/g, (c) => "\\x" + hex(c))
        .replace(/[\u0100-\u0FFF]/g, (c) => "\\u0" + hex(c))
        .replace(/[\u1000-\uFFFF]/g, (c) => "\\u" + hex(c));
    }
  }

  class Comment extends LiteralNode {
    value: string;

    constructor(value: string = "") {
      super();
      this.value = value;
    }

    toCode() {
      return this.value
        .split("\n")
        .map((line) => "// " + line.trim())
        .join("\n");
    }

    toType(): Type {
      return SimpleType.from("undefined");
    }
  }

  class NullLiteral extends LiteralNode {
    toCode() {
      return "null";
    }

    toType(): Type {
      return SimpleType.from("null");
    }
  }

  class UndefinedLiteral extends LiteralNode {
    toCode() {
      return "undefined";
    }

    toType(): Type {
      return SimpleType.from("undefined");
    }
  }

  class NumberLiteral extends LiteralNode {
    value: number;

    constructor(value: number = 0) {
      super();
      this.value = value;
    }

    toCode(): string {
      return String(this.value);
    }

    toType(): Type {
      return SimpleType.from("number");
    }
  }

  class ArrayLiteral<T extends Node> extends LiteralNode {
    values: T[];

    constructor(values?: T[]) {
      super();

      if (values !== undefined) {
        this.values = values;
      } else {
        this.values = [];
      }
    }

    toCode(): string {
      return `[${this.values.map((v) => v.toCode()).join()}]`;
    }

    toType(): Type {
      throw new Error("not supported");
    }
  }

  type FullSet<T> = Set<T> & { symmetricDifference: (s: Set<T>) => Set<T> };

  class ObjectLiteral extends LiteralNode {
    definitions: Definition[];

    constructor(definitions: Definition[]) {
      super();
      this.definitions = definitions;
    }

    toCode(): string {
      return (
        `
      {` +
        this.definitions.map((d) => d.toCode()).join(", ") +
        `
      }
    `
      );
    }

    toType(): Type {
      throw new Error("not supported");
    }
  }

  class Return implements ResultNode {
    node: ResultNode;

    constructor(node: ResultNode) {
      this.node = node;

      if (node instanceof Return) {
        throw new Error();
      }
    }

    toCode() {
      if (isReturnNode(this.node)) {
        return this.node.toReturnCode();
      } else {
        return `return ${this.node.toCode().trim()}`;
      }
    }

    toType(): ResultType {
      return this.node.toType();
    }
  }

  class Expectation extends Reusable {
    type: "literal" | "class" | "any" | "end" | "pattern" | "other";
    value: StringLiteral;

    private constructor(
      type: "literal" | "class" | "any" | "end" | "pattern" | "other",
      value: StringLiteral,
    ) {
      super();

      this.type = type;
      this.value = value;
    }

    static from(
      type: "literal" | "class" | "any" | "end" | "pattern" | "other",
      v: string,
    ): Expectation {
      const value = StringLiteral.from(v);
      const found = Reusable.find(
        (i) => i instanceof Expectation && i.type === type && i.value === value,
      );

      if (found !== undefined) {
        return found as Expectation;
      } else {
        return new Expectation(type, value);
      }
    }

    toDefinition(): string {
      return `const ${this.name}: runtime.Expectation = {
        type: "${this.type}",
        value: ${this.value.toCode()}
      }`;
    }

    toCode(): string {
      return this.name;
    }

    toType(): Type {
      return SimpleType.from("runtime.Expectation");
    }
  }

  class Failure implements ResultNode {
    expectations: Expectation[];
    remainder: Node;

    constructor(expectations: Expectation[], remainder: Node) {
      this.expectations = expectations;
      this.remainder = remainder;
    }

    toCode() {
      return `{
        success: false,
        expectations: [${this.expectations.map((e) => e.toCode()).join()}],
        remainder: ${this.remainder.toCode()}
      }`;
    }

    toType() {
      return FailureType.singleton;
    }
  }

  class KnownFailure implements ResultNode {
    node: ResultNode;

    constructor(node: ResultNode) {
      this.node = node;
    }

    toCode() {
      return this.node.toCode();
    }

    toType() {
      return FailureType.singleton;
    }
  }

  class Success implements ResultNode {
    value: Node;
    remainder: Node;
    type: SuccessType;

    constructor(value: Node, remainder: Node) {
      this.value = value;
      this.remainder = remainder;

      this.type = SuccessType.from(value.toType());
    }

    toCode(): string {
      return `{
        success: true,
        value: ${this.value.toCode()},
        remainder: ${this.remainder.toCode()}
      }`;
    }

    toType(): SuccessType {
      return this.type;
    }
  }

  class Parser extends Function {
    constructor(grammar: Peggy.ast.Grammar) {
      super(grammar.location);

      this.header = new Empty();
      this.setBody(
        new Return(
          new Antecedent(
            new Invocation(
              Function.from(grammar.rules[0] as Peggy.ast.Rule),
              this.args,
            ),
            (a) =>
              new IfElse(
                new Equals(
                  new Access(a, StringLiteral.from("success")),
                  BooleanLiteral.from(true),
                ),
                new IfElse(
                  new Equals(
                    new Length(new Access(a, StringLiteral.from("remainder"))),
                    new NumberLiteral(0),
                  ),
                  a,
                  new Failure(
                    [Expectation.from("end", "end of input")],
                    new Access(a, StringLiteral.from("remainder")),
                  ),
                ),
                a,
              ),
          ),
        ),
      );
    }
  }

  class Spread implements Node {
    node: Node;

    constructor(node: Node) {
      this.node = node;
    }

    toCode(): string {
      return `...${this.node.toCode()}`;
    }

    toType(): Type {
      throw new Error("not supported");
    }
  }

  class Choice extends Function {
    constructor(choice: Peggy.ast.Choice) {
      super(choice.location);

      const alternatives = choice.alternatives.map((a) => Function.from(a));

      this.setBody(new Return(new First(alternatives, this.args[0])));
    }
  }

  class First implements ResultNode, ReturnNode {
    funcs: Function[];
    remainder: Node;

    constructor(funcs: Function[], remainder: Node) {
      this.funcs = funcs;
      this.remainder = remainder;
    }

    toReturnCode(): string {
      return `
        const choices = [${this.funcs.map((f) => f.toCode()).join()}];
        const expectations: runtime.Expectation[] = [];

        for (let func = choices.shift(); func !== undefined; func = choices.shift()) {
          const result = func(${this.remainder.toCode()});

          if (result.success === true) {
            return result;
          } else {
            expectations.push(...result.expectations);
          }
        }

        return {
          success: false,
          expectations: [...new Set(expectations)],
          remainder: ${this.remainder.toCode()}
        };
      `;
    }

    toCode(): string {
      return `(() => {${this.toReturnCode()}})()`;
    }

    toType(): ResultType {
      return UnionType.from(...this.funcs.map((f) => ReturnType.from(f)));
    }
  }

  class Rule extends Function {
    sub: Function;

    constructor(rule: Peggy.ast.Rule) {
      super(rule.location);

      this.sub = Function.from(rule.expression);
      this.returnType = ReturnType.from(this.sub);
    }

    toCode(): string {
      if (this.sub !== undefined) {
        return this.sub.toCode();
      } else {
        // Needed during type inference since the sub-function is in the process of being defined
        return super.toCode();
      }
    }

    toDefinition(): string {
      if (this.sub !== undefined) {
        return "";
      } else {
        return super.toDefinition();
      }
    }
  }

  class SimpleNot extends Function {
    constructor(not: Peggy.ast.Prefixed) {
      super(not.location);

      this.setBody(
        new Return(new Invert(Function.from(not.expression), this.args[0])),
      );
    }
  }

  class Named extends Function {
    readonly originalName: string;

    constructor(named: Peggy.ast.Named) {
      super(named.location);

      this.originalName = named.name;

      this.setBody(
        new Return(
          new Antecedent(
            new Invocation(Function.from(named.expression), this.args),
            (a) =>
              new IfElse(
                new Access(a, StringLiteral.from("success")),
                a,
                new Failure(
                  [Expectation.from("other", this.originalName)],
                  new Access(a, StringLiteral.from("remainder")),
                ),
              ),
          ),
        ),
      );
    }
  }

  class Invert implements ResultNode {
    func: Function;
    remainder: Node;

    constructor(func: Function, remainder: Node) {
      this.func = func;
      this.remainder = remainder;
    }

    toType(): ResultType {
      return UnionType.from(
        SuccessType.from(SimpleType.from("undefined")) as
          | SuccessType
          | FailureType,
        FailureType.singleton,
      );
    }

    toCode(): string {
      const expectation = Expectation.from(
        "other",
        `not matching ${JSON.stringify(this.func.name)}`,
      );

      return `
        (() => {
          const result = ${this.func.toCode()}(${this.remainder.toCode()});

          if (result.success) {
            return {
              success: false,
              expectations: [${expectation.toCode()}],
              remainder: ${this.remainder.toCode()}
            }
          } else {
            return {
              success: true,
              value: undefined,
              remainder: ${this.remainder.toCode()}
            };
          }
        })()
      `;
    }
  }

  class Text extends Function {
    constructor(text: Peggy.ast.Prefixed) {
      super(text.location);

      try {
        this.setBody(new Return(new Capture(text.expression, this.args[0])));
      } catch (e) {
        this.setBody(
          new Return(new Extract(Function.from(text.expression), this.args[0])),
        );
      }
    }
  }

  class Capture implements ReturnNode, ResultNode {
    regexp: RegExpLiteral;
    value: Node;

    constructor(origin: Origin, value: Node) {
      this.regexp = new RegExpLiteral(origin);
      this.value = value;
    }

    toType() {
      return UnionType.from<ResultType>(
        SuccessType.from(SimpleType.from("string")),
        FailureType.singleton,
      );
    }

    toCode() {
      return `(() => { ${this.toReturnCode()} })()`;
    }

    toReturnCode() {
      return `
        const matches = ${this.value.toCode()}.match(${this.regexp.toCode()});

        if (matches?.length === 1) {
          return {
            success: true,
            value: matches[0],
            remainder: ${this.value.toCode()}.slice(matches[0].length)
          };
        } else {
          return {
            success: false,
            expectations: ${this.regexp.getExpectations().toCode()},
            remainder: ${this.value.toCode()}
          }
        }
      `;
    }
  }

  class Extract implements ResultNode, ReturnNode {
    func: Function;
    remainder: Node;

    constructor(func: Function, remainder: Node) {
      this.func = func;
      this.remainder = remainder;
    }

    toType(): ResultType {
      return UnionType.from(
        SuccessType.from(SimpleType.from("string")) as
          | SuccessType
          | FailureType,
        FailureType.singleton,
      );
    }

    toCode(): string {
      return `
        (() => {
          ${this.toReturnCode()}
        })()
      `;
    }

    toReturnCode(): string {
      return `
        const result = ${this.func.toCode()}(${this.remainder.toCode()});

        if (result.success === true) {
          return {
            success: true,
            value: ${this.remainder.toCode()}.slice(0, ${this.remainder.toCode()}.length - result.remainder.length),
            remainder: result.remainder
          }
        } else {
          return result;
        }
      `;
    }
  }

  class Label extends Function {
    label: string;
    sub: Function;

    constructor(label: Peggy.ast.Labeled) {
      super(label.location);

      this.sub = Function.from(label.expression);
      this.returnType = ReturnType.from(this.sub);

      if (typeof label.label === "string") {
        this.label = label.label;
      } else {
        throw new Error("cannot label without a label");
      }
    }

    toLabel(): string | boolean {
      return this.label;
    }

    toCode(): string {
      return this.sub.toCode();
    }

    toDefinition(): string {
      return "";
    }
  }

  class Pick extends Function {
    sub: Function;

    constructor(label: Peggy.ast.Labeled) {
      super(label.location);

      this.sub = Function.from(label.expression);
      this.returnType = ReturnType.from(this.sub);
    }

    toLabel(): string | boolean {
      return true;
    }

    toCode(): string {
      return this.sub.toCode();
    }

    toDefinition(): string {
      return "";
    }
  }

  interface NodeTransformer {
    (from: Node): Node;
  }

  class Access {
    node: Node;
    key: Node & Stringy;

    constructor(node: Node, key: Node) {
      this.node = node;
      this.key = key;
    }

    toCode(): string {
      if (this.key instanceof NumberLiteral) {
        return `${this.node.toCode()}[${this.key.toCode()}]`;
      } else {
        return `${this.node.toCode()}.${this.key.toString()}`;
      }
    }

    toType(): Type {
      return this.node.toType().propertyType(this.key);
    }
  }

  class Not implements Node {
    node: Node;
    readonly type: Type = SimpleType.from("boolean");

    constructor(node: Node) {
      this.node = node;
    }

    toCode(): string {
      return `!${this.node.toCode()}`;
    }

    toType(): Type {
      return this.type;
    }
  }

  class InstanceOf implements Node {
    node: Node;
    type: Type;

    constructor(node: Node, type: Type) {
      this.node = node;
      this.type = type;
    }

    toCode(): string {
      return `${this.node.toCode()} instanceof ${this.type.toCode()}`;
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class Attempt<N extends ResultNode> implements ResultNode, ReturnNode {
    node: Antecedent<N>;

    constructor(
      attempt: N,
      then?: Runner<N>,
      fallback?: Runner<N>,
      index?: number,
    ) {
      this.node = new Antecedent(
        attempt,
        (a) =>
          new IfElse(
            new Equals(
              new Access(a, StringLiteral.from("success")),
              BooleanLiteral.from(true),
            ),
            then !== undefined ? then(a) : a,
            fallback !== undefined ? fallback(a) : new KnownFailure(a),
          ),
        index,
      );
    }

    toCode(): string {
      return this.node.toCode();
    }

    toReturnCode(): string {
      return this.node.toReturnCode();
    }

    toType(): ResultType {
      return this.node.toType();
    }
  }

  class IfElse implements ResultNode {
    condition: Node;
    ifTrue: ResultNode;
    elseFalse: ResultNode;

    constructor(condition: Node, ifTrue: ResultNode, elseFalse: ResultNode) {
      this.condition = condition;
      this.ifTrue = ifTrue;
      this.elseFalse = elseFalse;
    }

    toCode(): string {
      return `
      (${this.condition.toCode()})?
        (${this.ifTrue.toCode()})
      :
        (${this.elseFalse.toCode()})
    `;
    }

    toReturnCode(): string {
      return `
        if (${this.condition.toCode()}) {
          ${new Return(this.ifTrue).toCode()};
        } else {
          ${new Return(this.elseFalse).toCode()};
        }
      `;
    }

    toType(): ResultType {
      return UnionType.from(this.ifTrue.toType(), this.elseFalse.toType());
    }
  }

  class Sequence extends Function {
    constructor(sequence: Peggy.ast.Sequence) {
      super(sequence.location);

      const reduction = new Reduction(sequence.elements, this.args[0]);

      this.setBody(new Return(reduction));
    }
  }

  class Equal implements Node {
    left: Node;
    right: Node;

    constructor(left: Node, right: Node) {
      this.left = left;
      this.right = right;
    }

    toCode(): string {
      return `${this.left.toCode()} === ${this.right.toCode()}`;
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class StartsWith implements Node {
    haystack: Node;
    needle: Node;

    constructor(haystack: Node, needle: Node) {
      this.haystack = haystack;
      this.needle = needle;
    }

    toCode(): string {
      return `${this.haystack.toCode()}.startsWith(${this.needle.toCode()})`;
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }
  }

  class Slice implements Node {
    value: Node;
    start: Node;
    length: Node;

    constructor(
      value: Node,
      start: Node = new NumberLiteral(0),
      length: Node = new UndefinedLiteral(),
    ) {
      this.value = value;
      this.start = start;
      this.length = length;
    }

    toCode(): string {
      return (
        `${this.value.toCode()}.slice(` +
        this.start.toCode() +
        (this.length.toType() !== SimpleType.from("undefined")
          ? `, ${this.length.toCode()}`
          : "") +
        `)`
      );
    }

    toType(): Type {
      return SimpleType.from("string");
    }
  }

  class Literal extends Function {
    constructor(literal: Peggy.ast.Literal) {
      super(literal.location);

      const value = StringLiteral.from(literal.value);

      this.setBody(
        new Return(
          new IfElse(
            new StartsWith(this.args[0], value),
            new Success(
              value,
              new Slice(this.args[0], new NumberLiteral(literal.value.length)),
            ),
            new Failure(
              [Expectation.from("literal", literal.value)],
              this.args[0],
            ),
          ),
        ),
      );
    }
  }

  class RegExpLiteral implements Node {
    regexp: string;
    expectations: ArrayLiteral<Expectation>;

    constructor(origin: Origin) {
      const ignoreCaseFlag =
        origin.type === "class" && origin.ignoreCase ? "i" : "";
      this.regexp = `/^${RegExpLiteral.toRegExpString(origin)}/g${ignoreCaseFlag}`;
      this.expectations = new ArrayLiteral([
        Expectation.from("other", `matching ${this.regexp}`),
      ]);
    }

    getExpectations() {
      return this.expectations;
    }

    private static toRegExpString(
      origin: Origin,
      parents: Origin[] = [],
    ): string {
      if (parents.indexOf(origin) !== -1) {
        throw new Error("Cannot represent recursion in a regular expression.");
      }

      switch (origin.type) {
        case "rule":
        case "labeled":
        case "named":
        case "text":
        case "group":
          return RegExpLiteral.toRegExpString(origin.expression, [
            ...parents,
            origin,
          ]);
        case "rule_ref":
          const foundOrigin = grammar.rules.find((r) => r.name === origin.name);

          if (foundOrigin !== undefined) {
            return RegExpLiteral.toRegExpString(foundOrigin, [
              ...parents,
              origin,
            ]);
          } else {
            throw new Error(`bad rule reference: ${origin.name}`);
          }
        case "choice":
          return `(${origin.alternatives.map((a) => RegExpLiteral.toRegExpString(a, [...parents, origin])).join("|")})`;
        case "sequence":
          return `${origin.elements.map((e) => RegExpLiteral.toRegExpString(e, [...parents, origin])).join("")}`;
        case "literal":
          return RegExpLiteral.escapeLiteral(origin.value);
        case "optional":
          return `(${RegExpLiteral.toRegExpString(origin.expression, [...parents, origin])})?`;
        case "simple_not":
          return `(?!${RegExpLiteral.toRegExpString(origin.expression, [...parents, origin])})`;
        case "zero_or_more":
          return `(${RegExpLiteral.toRegExpString(origin.expression, [...parents, origin])})*`;
        case "one_or_more":
          return `(${RegExpLiteral.toRegExpString(origin.expression, [...parents, origin])})+`;
        case "repeated":
          if (origin.delimiter !== null) {
            if (
              typeof origin.max?.value === "number" &&
              origin.max?.value < 2
            ) {
              throw new Error(
                "delimiter cannot exist if max count is less than two",
              );
            }

            const outerOptional =
              typeof origin.max?.value !== "number" || origin.min?.value == 0;
            const innerMin =
              typeof origin.min?.value === "number" && origin.min.value > 0
                ? origin.min.value - 1
                : 0;
            const innerMax =
              typeof origin.max?.value === "number" && origin.max.value > 0
                ? origin.max.value - 1
                : "";
            return `(${RegExpLiteral.toRegExpString(origin.expression, [...parents, origin])}(${RegExpLiteral.toRegExpString(origin.delimiter, [...parents, origin]) + RegExpLiteral.toRegExpString(origin.expression, [...parents, origin])}){${innerMin},${innerMax}})${outerOptional ? "?" : ""}`;
          } else {
            const innerMin =
              typeof origin.min?.value === "number" && origin.min.value > 0
                ? origin.min.value
                : 0;
            const innerMax =
              typeof origin.max?.value === "number" && origin.max.value > 0
                ? origin.max.value
                : "";

            return `(${RegExpLiteral.toRegExpString(origin.expression, [...parents, origin])}){${innerMin},${innerMax}}`;
          }
        case "any":
          return ".";
        case "class":
          if (origin.ignoreCase && parents.length > 0) {
            throw new Error("cannot handle nested ignore case");
          }

          return `[${
            (origin.inverted ? "^" : "") +
            origin.parts
              .map((part) => {
                if (Array.isArray(part)) {
                  if (part.length === 2) {
                    return (
                      RegExpLiteral.escapeClassCharacter(part[0] as string) +
                      "-" +
                      RegExpLiteral.escapeClassCharacter(part[1] as string)
                    );
                  } else {
                    throw new Error("invalid character class");
                  }
                } else {
                  return RegExpLiteral.escapeClassCharacter(part);
                }
              })
              .join("")
          }]`;
        case "action":
        default:
          throw new Error(
            `Cannot represent ${origin.type} in a regular expression.`,
          );
      }
    }

    static escapeClassCharacter(s: string) {
      return s
        .replace(/\\/g, "\\\\")
        .replace(/\//g, "\\/")
        .replace(/]/g, "\\]")
        .replace(/\^/g, "\\^")
        .replace(/-/g, "\\-")
        .replace(/\0/g, "\\0")
        .replace(/\x08/g, "\\b")
        .replace(/\t/g, "\\t")
        .replace(/\n/g, "\\n")
        .replace(/\v/g, "\\v")
        .replace(/\f/g, "\\f")
        .replace(/\r/g, "\\r")
        .replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch))
        .replace(/[\x10-\x1F\x7F-\xFF]/g, (ch) => "\\x" + hex(ch))
        .replace(/[\u0100-\u0FFF]/g, (ch) => "\\u0" + hex(ch))
        .replace(/[\u1000-\uFFFF]/g, (ch) => "\\u" + hex(ch));
    }

    static escapeLiteral(s: string) {
      return s
        .replace(/[.*+?^${}()|[\]\\\//\0\x08\t\n\v\f\r]/g, "\\$&")
        .replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch))
        .replace(/[\x10-\x1F\x7F-\xFF]/g, (ch) => "\\x" + hex(ch))
        .replace(/[\u0100-\u0FFF]/g, (ch) => "\\u0" + hex(ch))
        .replace(/[\u1000-\uFFFF]/g, (ch) => "\\u" + hex(ch));
    }

    toType(): Type {
      return SimpleType.from("RegExp");
    }

    toCode() {
      return this.regexp;
    }
  }

  class Match implements Node {
    regexp: RegExpLiteral;
    value: Node;

    constructor(regexp: RegExpLiteral, value: Node) {
      this.regexp = regexp;
      this.value = value;
    }

    toType() {
      return SimpleType.from("boolean");
    }

    toCode() {
      return `${this.regexp.toCode()}.test(${this.value.toCode()})`;
    }
  }

  class Any extends Function {
    constructor(any: Peggy.ast.Any) {
      super(any.location);

      this.setBody(
        new Return(
          new IfElse(
            new GreaterThan(new Length(this.args[0]), new NumberLiteral(0)),
            new Success(
              new Slice(
                this.args[0],
                new NumberLiteral(0),
                new NumberLiteral(1),
              ),
              new Slice(this.args[0], new NumberLiteral(1)),
            ),
            new Failure(
              [Expectation.from("any", "any character")],
              this.args[0],
            ),
          ),
        ),
      );
    }
  }

  class Length implements Node {
    lengthy: Node;

    constructor(lengthy: Node) {
      this.lengthy = lengthy;
    }

    toType(): Type {
      return SimpleType.from("number");
    }

    toCode(): string {
      return `${this.lengthy.toCode()}.length`;
    }
  }

  class GreaterThan implements Node {
    left: Node;
    right: Node;

    constructor(left: Node, right: Node) {
      this.left = left;
      this.right = right;
    }

    toType(): Type {
      return SimpleType.from("boolean");
    }

    toCode() {
      return `${this.left.toCode()} > ${this.right.toCode()}`;
    }
  }

  class Class extends Function {
    constructor(cls: Peggy.ast.CharacterClass) {
      super(cls.location);

      const regexp = new RegExpLiteral(cls);

      this.setBody(
        new Return(
          new IfElse(
            new Match(regexp, this.args[0]),
            new Success(
              new Slice(
                this.args[0],
                new NumberLiteral(0),
                new NumberLiteral(1),
              ),
              new Slice(this.args[0], new NumberLiteral(1)),
            ),
            new Failure(
              [Expectation.from("pattern", regexp.toCode())],
              this.args[0],
            ),
          ),
        ),
      );
    }
  }

  class Definition implements Node {
    left: Node;
    right: Node;

    constructor(left: Node, right: Node) {
      this.left = left;
      this.right = right;
    }

    toCode(): string {
      return `${this.left.toCode()}: ${this.right.toCode()}`;
    }

    toType(): Type {
      return SimpleType.from("undefined");
    }
  }

  class Action extends Function {
    constructor(action: Peggy.ast.Action) {
      super(action.location);

      const func = Function.from(action.expression);

      const args: Argument[] = [];
      const unwrapped = func.returnType.unwrap();
      if (unwrapped instanceof Interface) {
        args.push(...unwrapped.toArguments());
      } else if (func instanceof Label) {
        args.push(new Argument(func.label, unwrapped));
      }

      this.setBody(
        new Return(
          new Attempt(new Invocation(func, this.args), (value) => {
            const remainder = new Access(
              value,
              StringLiteral.from("remainder"),
            );
            const values = args.map((a, i) => {
              if (a instanceof IndexedArgument) {
                return new Value(
                  a,
                  new Access(
                    new Access(value, StringLiteral.from("value")),
                    new NumberLiteral(a.index),
                  ),
                );
              } else {
                return new Value(
                  a,
                  new Access(value, StringLiteral.from("value")),
                );
              }
            });

            return new Success(
              Code.from(action, values, this.args[0], remainder),
              remainder,
            );
          }),
        ),
      );
    }
  }

  class Partial implements Node {
    func: Function;
    index: number;

    constructor(func: Function, index: number) {
      this.func = func;
      this.index = index;
    }

    toCode(): string {
      return `
        (r: string) => {
          const result = ${this.func.name}(r);

          if (result.success === true) {
            return {
              success: true.
              value: {
                $${this.index}: result.value
              },
              remainder: result.remainder
            };
          } else {
            return result;
          }
        }
      `;
    }

    toType(): Type {
      throw new Error("cannot get type of partial function");
    }
  }

  class Reduction implements ResultNode {
    interface: Interface;
    remainder: Argument;
    elements: (Function | RegExpLiteral)[] = [];
    functions: Function[] = [];
    pickIndex: number;
    valueType: Type;

    constructor(
      elements: Origin[],
      remainder: Argument,
      insideAction: boolean = false,
    ) {
      this.pickIndex = elements.findIndex(
        (e) => e.type === "labeled" && e.label === null,
      );

      for (let i = 0; i < elements.length; ++i) {
        const element = elements[i];
        if (
          (this.pickIndex !== -1 &&
            !(element.type === "labeled" && element.label === null)) ||
          (insideAction && element.type !== "labeled")
        ) {
          try {
            this.elements.push(new RegExpLiteral(element));
          } catch (e) {
            this.elements.push(Function.from(element));
          }
        } else {
          const func = Function.from(element);
          this.elements.push(func);
          this.functions.push(func);
        }
      }

      this.interface = Interface.from(
        this.functions.map((f) =>
          Property.from(f.returnType.unwrap(), f.toLabel()),
        ),
      );

      this.remainder = remainder;

      this.valueType =
        this.pickIndex !== -1
          ? ReturnType.from(this.elements[this.pickIndex] as Pick).unwrap()
          : this.interface;
    }

    toReturnCode() {
      return `
        let remainder = ${this.remainder.toCode()};
        ${this.elements
          .map((e, i) => {
            if (e instanceof Function) {
              return `
                const result${i} = ${e.toCode()}(remainder);

                if (result${i}.success === false) {
                  return result${i};
                } else {
                  remainder = result${i}.remainder;
                }
              `;
            } else {
              return `
                const result${i} = remainder.match(${e.toCode()});

                if (result${i}?.length !== 1) {
                  return {
                    success: false,
                    expectations: ${e.getExpectations().toCode()},
                    remainder
                  }
                } else {
                  remainder = remainder.slice(result${i}[0].length);
                }
              `;
            }
          })
          .join("\n")}

        ${
          this.pickIndex !== -1
            ? `
          return {
            success: true,
            value: result${this.pickIndex}.value,
            remainder
          }`
            : `return {
            success: true,
            value: [${this.functions.map((f) => `result${this.elements.indexOf(f)}.value`).join()}],
            remainder
          }`
        }`;
    }

    toCode() {
      return `((): runtime.Success<${this.interface.toCode()}> | runtime.Failure => {
        ${this.toReturnCode()}
      })()`;
    }

    toType(): ResultType {
      return UnionType.from<ResultType>(
        SuccessType.from(this.valueType),
        FailureType.singleton,
      );
    }
  }

  const parser = new Parser(grammar);
  const reusables = Reusable.getDirectory();

  let initializer = "";

  if (Array.isArray(grammar.initializer)) {
    initializer = grammar.initializer.map((i) => i.code).join("\n");
  } else if (grammar.initializer?.code !== undefined) {
    initializer = grammar.initializer.code;
  }

  let code = `
    ${runtime}

    ${getHeaderCode()}

    ${reusables
      .filter((r) => r instanceof Expectation)
      .map((r) => r.toDefinition())
      .join("\n")}
    ${reusables
      .filter((r) => r instanceof Interface)
      .map((r) => r.toDefinition())
      .join("\n")}

    export function parse(input: string, options: runtime.ParseOptions = new runtime.ParseOptions()): ${parser.returnType.unwrap().toCode()} {
      const parse$lines = input.split(/\\r\\n|\\r|\\n/);
      const parse$totalLength = input.length;
      const parse$source = options.grammarSource;

      ${initializer}

      const result = ${parser.name}(input);

      if (result.success === true) {
        return result.value;
      } else {
        throw new SyntaxError(
          result.expectations,
          result.remainder.slice(0, 1),
          runtime.getLocation(
            parse$source,
            input,
            result.remainder,
            result.remainder
          )
        );
      }

      ${reusables
        .filter((r) => r instanceof Code)
        .map((r) => r.toDefinition())
        .join("\n")}
      ${reusables
        .filter((r) => r instanceof Function)
        .map((r) => r.toDefinition())
        .join("\n")}
    }
  `;

  const formattedCode = compile(code, options);

  grammar.code = new SourceNode(null, null, options.grammarSource, [
    formattedCode,
  ]);
}
