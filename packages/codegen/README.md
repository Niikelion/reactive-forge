# @reactive-forge/codegen

Extract exported React components into portable prop metadata and a component registry. Bundle the generated registry for use in independent hosts.

```sh
npm install --save-dev @reactive-forge/codegen@2
npx forge init
npx forge --help
```

Configure source directories or entry files with `componentRoots`. Extraction follows reexports and supports colocated/external slot annotations, prop presentation metadata and explicit class bindings.

Version 2 is a breaking rebuild of the original codegen package. Use the matching version-2 schema, runtime and editor packages. The old shared/ui package APIs are not drop-in replacements.

See [Reactive Forge](https://github.com/Niikelion/reactive-forge) and the [class adapter guide](https://github.com/Niikelion/reactive-forge/blob/master/docs/class-values-implementation-report.md).
