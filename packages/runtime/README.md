# @reactive-forge/runtime

Validate and render React component compositions, then export them to TSX. Includes Date, URL, Map, Set, RegExp and explicit custom-class adapters.

```sh
npm install @reactive-forge/runtime@2 @reactive-forge/schema@2 react@19
```

Core APIs: `validateComposition`, `renderComposition`, `exportToTsx`, `encodeAdapterValue`.

Hosts register group membership explicitly and can supply a default value factory:

```ts
import {Text} from "@reactive-forge/schema"
import {registerComponent, defineGroupValueFactory, createGroupValue} from "@reactive-forge/runtime"

const entry = registerComponent(TextContent, {id: "host/text", args: textPropsSchema, groups: [Text]})
const library = {
  files: [{path: "host", components: {TextContent: entry}}],
  groupValueFactories: [defineGroupValueFactory(Text, (text: string) => ({
    kind: "instance", instanceId: crypto.randomUUID(), componentId: entry.id,
    props: {text: {kind: "composed", value: {kind: "leaf", value: {type: "string", value: text}}}}
  }))]
}
const instance = createGroupValue(Text, "Hello", library, metadata)
```

`textPropsSchema` is the component's prop schema and `metadata` describes the same registered component. Factories must have exactly one default per requested group and return a valid registered member. Their results are ordinary concrete instances: insert them into `nodes` slots and save them normally. Changing a factory later never changes saved instances. Rich text uses the same mechanism; its input format, rendering and editor belong to the host.

Legacy `richText` values require explicit conversion to host component instances. Migration diagnoses them rather than choosing a content implementation.

Use composition version 4 for class values. Version 3 compositions without class values remain supported; older documents require the migration helpers.

See [Reactive Forge](https://github.com/Niikelion/reactive-forge).
