# Reactive Forge

> This project is being rebuilt. The usage and UI documentation below describe the earlier implementation; the current checkout contains schema and code-generation packages. See the [development plan](docs/development-plan.md) and [verified baseline](docs/baseline.md) for current capabilities, checks, and known regressions.

Reactive Forge is a metadata generator for react components.
It generates files exposing list of components with descriptions of their arguments.
Can be used to create component library preview or ui designer with components imported from code.

## Features

* Extraction of component metadata
* Rendering the component from metadata and argument values with typechecking
* Easily creating preview of your component with option to edit arguments from the ui

## Getting started

First, install `@reactive-forge/codegen` package:

```shell
npm install -D @reactive-forge/codegen
```

or

```shell
yarn add --dev @reactive-forge/codegen
```

Then run `npx forge init` and follow instructions in the command line.
Last, but not least, add `forge &&` at the beginning of your dev and build scripts.
And with that, you're good to go!

## Packages

List of Reactive Forge packages with links to their documentations:

* [@reactive-forge/codegen](packages/codegen/README.md)
* [@reactive-forge/ui](packages/ui/README.md)
* [@reactive-forge/shared](packages/shared/README.md)

## Supported argument types

Since Reactive Forge handles schema validation and values creation, some restrictions were placed on component argument types.
See the table below:

| Type                    | Supported | Remarks                                                                                               |
|-------------------------|-----------|-------------------------------------------------------------------------------------------------------|
| undefined               | ✔         |                                                                                                       |
| null                    | ✔         |                                                                                                       |
| boolean                 | ✔         | boolean literals are also supported                                                                   |
| number                  | ✔         | number literals are also supported                                                                    |
| string                  | ✔         | string literals are also supported                                                                    |
| string template literal | ❌         | not planned                                                                                           |
| Date                    | ✔         |                                                                                                       |
| BigInt                  | ❌         | if you need this type to be supported, create an issue for it                                         |
| unknown                 | ❌         | may be added in the future                                                                            |
| any                     | ❌         | may be added in the future                                                                            |
| never                   | ❌         | may be added in the future                                                                            |
| class                   | ❌         | may be added in the future                                                                            |
| symbol                  | ❌         | not planned                                                                                           |
| array                   | ✔         |                                                                                                       |
| tuple                   | ✔         | will be supported in the future                                                                       |
| object                  | ✔*        | optional properties with unsupported types will be dropped, see below for implications                |
| function                | ❌*        | will be partially supported in the future                                                             |
| union                   | ✔         |                                                                                                       |
| intersection            | ✔*        | you can have intersections in your type, they will be evaluated and stripped before schema generation |
| cyclic                  | ❌         | schema format does not support references                                                             |
| ReactNode               | ✔         |                                                                                                       |

Due to the fact, that optional object properties that have unsupported type are dropped before intersections are calculated,
it is possible that intersection of object types will be incorrectly calculated - resulting type will be broader than it should be.

## Planned features:

* Rendering custom components defined in json format
* Compiling custom components defined in json format into tsx and jsx
* Partial support for functions
