# @reactive-forge/runtime

Validate and render React component compositions, then export them to TSX. Includes Date, URL, Map, Set, RegExp and explicit custom-class adapters.

```sh
npm install @reactive-forge/runtime@2 @reactive-forge/schema@2 react@19
```

Core APIs: `validateComposition`, `renderComposition`, `exportToTsx`, `encodeAdapterValue`.

TSX export writes `children` directly inside the element (`<Card><Child /></Card>`) without an extra Fragment wrapper. Other React node props remain JSX attributes. Composition storage and validation still treat `children` as a regular prop.

## Public props and bindings

Composition version 5 declares the generated component's public props explicitly. A binding references a declaration; it never creates one. The same mechanism accepts strings, numbers, objects, React nodes, component types, and functions, including bindings nested inside object and array values.

```ts
const document = {
  schemaVersion: 5,
  props: {
    label: {schema: {type: "string"}, required: true},
    onSave: {
      schema: buttonMetadata.props.onClick.schema,
      required: true,
      typeSource: {componentId: buttonMetadata.id, propName: "onClick"}
    }
  },
  root: {
    kind: "instance", instanceId: "save-button", componentId: buttonMetadata.id,
    props: {
      children: {kind: "prop", name: "label"},
      onClick: {kind: "prop", name: "onSave"}
    }
  }
} satisfies CompositionDocument

renderComposition(document, metadata, library, {
  props: {label: "Save", onSave: handleSave}
})
```

Import `CompositionDocument` from `@reactive-forge/runtime` for the example's type. `buttonMetadata` describes the registered button and its actual props. `typeSource` is an explicit reference to an existing component prop: export preserves that prop's TypeScript signature using `ComponentProps`. The declaration's schema still supplies portable runtime and editor metadata.

An optional declaration uses `required: false`; an optional `defaultValue` uses the existing `ValueJson` format. All declarations appear in the generated API, even when currently unused. A component with no declarations takes no props argument. Export never injects a `callbacks` prop or derives public props from bindings.

Use `{kind: "prop", name: "label"}` inside a recursive `CompositionValue` to bind a nested object field or array entry. Bindings reference whole public values; they do not execute expressions or contain source code. Validation rejects undeclared bindings and incompatible declared schemas. Rendering additionally checks supplied values and required inputs.

React node inputs currently accept synchronous elements, scalar nodes, and arrays of those values. Promise nodes, portals, and other iterables require host conversion before preview rendering. Slot restrictions still apply to supplied elements, including component groups and nested slot cardinality.

Legacy version 3/4 callback registries remain available for live rendering. TSX export rejects legacy callback references: declare the function input explicitly in a version 5 document and replace the callback reference with a prop binding. Conversion does not infer declarations.

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

Use composition version 4 or 5 for class values. Version 3 compositions without class values remain supported; older documents require the migration helpers.

See [Reactive Forge](https://github.com/Niikelion/reactive-forge).
