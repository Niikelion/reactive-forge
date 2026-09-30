# @reactive-forge/codegen

Extract exported React components into portable prop metadata and a component registry. Bundle the generated registry for use in independent hosts.

```sh
npm install --save-dev @reactive-forge/codegen@2
npx forge init
npx forge --help
```

Configure source directories or entry files with `componentRoots`. Extraction follows reexports and supports colocated/external slot annotations, prop presentation metadata and explicit class bindings.

Version 2 is a breaking rebuild of the original codegen package. Use the matching version-2 schema, runtime and editor packages. The old shared/ui package APIs are not drop-in replacements.

Annotate a component beside its declaration, or use companion library metadata and project overrides:

```ts
import {defineComponentMetadata} from "@reactive-forge/codegen"
import {RichText} from "@reactive-forge/schema"

export const richContentMetadata = defineComponentMetadata(RichContent, {groups: [RichText]})
export const cardMetadata = defineComponentMetadata(Card, {
  rules: [{path: ["content", "header", "title"], slot: {kind: "components", accepts: [RichText]}}]
})
```

Use `each()` for array entries and `variant()` for union branches. Static group declarations, imports and reexports are resolved without executing application code. Project group declarations replace library declarations; conflicting declarations in the same layer are diagnosed. Generated project registry entries include their explicit groups. Hosts provide external library implementations and register their groups.

The former `richText` policy is rejected with a migration diagnostic. Use ordinary component groups and host-owned content components instead.

See [Reactive Forge](https://github.com/Niikelion/reactive-forge).
