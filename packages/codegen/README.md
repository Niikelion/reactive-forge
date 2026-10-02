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

Framework adapters use the shared generation service:

```ts
import {createGenerationService} from "@reactive-forge/codegen"

const service = await createGenerationService({}, {projectRootDir: process.cwd()})
await service.generate()
await service.watch()
// On framework shutdown:
await service.close()
```

The service discovers `forge.config.ts`, resolves its paths relative to that file, and lets inline config override file values. Set `configFile: false` to disable discovery or give an explicit path to require that config file. Frameworks can supply `defaultTsConfigFilePath`, which applies only when no config file or inline config selects a TypeScript configuration.

Each generation builds a fresh TypeScript project. Changes, additions, deletions, annotations, imported config modules and TypeScript configuration dependencies trigger regeneration. Generated output, dependency directories and framework build output do not feed back into generation. Watch errors go to `onError` and later edits can recover; initial `generate()` errors reject its promise so builds fail visibly. Watchers do not keep a finished build process running.

Adapters that already own a file watcher can add `service.watchPaths`, call `service.invalidate(file)` on relevant events, and refresh watched paths from `onGenerated`. `invalidate` debounces changes; `flush()` awaits pending work. `close()` cancels queued work and waits for active generation.

See [Reactive Forge](https://github.com/Niikelion/reactive-forge).
