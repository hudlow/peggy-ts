# peggy-ts

`peggy-ts` is a plugin for the excellent [Peggy (JS)][peggy] parser generator. Peggy natively
compiles a parser which is written in a [PEG][peg] syntax into a JavaScript function. Peggy source
grammars can themselves express complete programs, as JavaScript may be embedded in a grammar to
process parsed text.

Peggy itself works by parsing a Peggy grammar into an AST, running validations and optimizations on
the AST, compiling the AST to a bytecode format, and compiling the bytecode to a JavaScript function
without any external dependencies (save for those that might have been in the source grammar).

`peggy-ts` replaces the [bytecode][bc] and [JavaScript][js] generation stages of the Peggy compiler
with a single stage that compiles a validated and optimized AST to TypeScript.

## Objectives

My goal is for this plugin to be fully compatible with existing Peggy grammars (including all the
embedded JavaScript) but to allow a grammar to be written that produces a parser which passes
TypeScript compiler checks with flying colors with minimal use of workarounds such as `any` types
and `as` casting. Ostensibly, this should ensure the parsers are robust and free of the sorts of
defects that static type checking generally spares one.

I also hope for the generated parsers to be easy to read and fast.

## Usage

In theory, usage should be as easy as:

```
npm install --save-dev github:hudlow/peggy-ts
```

and:

```
peggy my-grammar.peggy --plugin peggy-ts -o ./my-parser.ts
```

But, there may be some fussy aspects to this. If it helps, I have created an [example project][eg].

## Status

This is my first TypeScript project of any consequence, and deeper than I've ever delved before on
formal grammars, parsers, code generation, and anything else resembling compiler work.

It is still very much in an experimental phase, but it can generate parsers for some fairly gnarly
grammars. For example, I've successfully used it to re-generate Peggy's own parser, and then used
the resulting parser to do that... again. (Something-something-"bootstrapping"?)

But there's a lot left to do. I am not very happy with how the code is organized, documented, or
tested, I suspect some features produce incorrect output (particularly some of the functions that
make up the execution environments for actions), and some features, like code map generation, are
missing entirely. Error handling is also a pretty big mess. I've been focused mostly on the happy
path.

I discovered [`ts-morph`][morph] while writing this plugin, and I think I now would like to rip out
and replace many of my bespoke `Node` types with the native TypeScript compiler types that
`ts-morph` exposes. I'm not yet sure how much this might simplify keeping track of types. If I
_don't_ do that, then I'll probably want to enhance my `Node` type to be a generic `Node<Type>` so I
can rely more on type checking within my plugin code to produce a correct program.

## Other notes

- There are many cases where the parser produced is probably kind of hilariously inefficient. For
  example, I do a whole lot of string slicing where I could be tracking indices. Some of those cases
  may be relatively easy to remedy, and other optimizations might be a lot more complex. I think
  perhaps certain grammar sequences could be transformed to regular expressions and rely on the much
  better performance of native code? Then again, I'm fairly happy with the performance I'm seeing.
  Modern JavaScript is really fast.
- Uhm, I don't even try to name generated functions and types nicely right now. Just haven't gotten
  around to it.
- There is one spot in generated code where I use `as` casting. I think it's simple enough that one
  can be quite confident that it's always correct, but I worked a long time to no avail to try to
  eliminate it.

If you have questions or comments feel free to open an issue or discussion or ping me on the
[CNCF Slack][slack].

[peggy]: https://peggyjs.org
[peg]: https://bford.info/pub/lang/peg.pdf
[bc]: https://github.com/peggyjs/peggy/blob/main/lib/compiler/passes/generate-bytecode.js
[js]: https://github.com/peggyjs/peggy/blob/main/lib/compiler/passes/generate-javascript.js
[eg]: https://github.com/hudlow/peggy-ts-example
[morph]: https://ts-morph.com
[slack]: https://communityinviter.com/apps/cloud-native/cncf
