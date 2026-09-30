# @reactive-forge/schema

Portable prop schemas and metadata for React component libraries. Includes nested slot policies, editor presentation rules, and class-value schemas.

```sh
npm install @reactive-forge/schema@2
```

Call `registerCommonSchemas()` before decoding schemas with `schemaFromJson()`.

Slots can accept specific component identities or ordinary component groups:

```ts
import {defineComponentGroup, Text, RichText} from "@reactive-forge/schema"

const Layout = defineComponentGroup("my-app/Layout")
const caption = {kind: "components", accepts: [Text, RichText]}
const body = {kind: "components", accepts: [Layout, {source: "project", id: "card"}]}
```

Entries in `accepts` combine with OR. An empty list accepts no components; `kind: "any"` permits unrestricted nodes. Void values still follow the slot's cardinality rules. Restrictions apply to the direct slot contents; nested component slots enforce their own rules.

`Text` and `RichText` identify `forge/Text` and `forge/RichText`. They have no special content format or rendering behavior. Hosts register actual components with `ComponentEntry.groups`. Metadata alone cannot grant membership. Unknown groups produce diagnostics; declare empty groups through `library.componentGroups`.

Part of [Reactive Forge](https://github.com/Niikelion/reactive-forge). Package version 2 supports metadata versions 1–4; package versions and document schema versions are separate.
