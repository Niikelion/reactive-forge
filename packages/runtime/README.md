# @reactive-forge/runtime

Validate and render React component compositions, then export them to TSX. Includes Date, URL, Map, Set, RegExp and explicit custom-class adapters.

```sh
npm install @reactive-forge/runtime@2 @reactive-forge/schema@2 react@19
```

Core APIs: `validateComposition`, `renderComposition`, `exportToTsx`, `encodeAdapterValue`.

Use composition version 4 for class values. Version 3 compositions without class values remain supported; older documents require the migration helpers.

See [class adapter usage](https://github.com/Niikelion/reactive-forge/blob/master/docs/class-values-implementation-report.md).
