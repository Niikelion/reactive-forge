# @reactive-forge/editor

React controls, previews and a composition canvas built on Reactive Forge schemas. Supports nested component slots, drag-and-drop editing, component groups and class payload forms.

```sh
npm install @reactive-forge/editor@2 @reactive-forge/runtime@2 @reactive-forge/schema@2 react@19
```

Core APIs include `CompositionEditor`, `ComponentPalette`, `PropControl` and `useComponentPreview`.

Version 5 compositions declare their public inputs in `document.props`. Pass preview values through `useComponentPreview({..., props})` or `CompositionEditor({..., props})`; functions are ordinary values for declared function inputs. Preview values never become saved declarations or new public props.

Pass `declaredProps: document.props` to `PropControl` to make function controls select explicit public inputs and emit `{kind: "prop", name}` bindings. Legacy callback registry controls remain available for version 3/4 documents. General prop bindings can also be saved at nested object fields and array entries; see the [runtime API](../runtime/README.md#public-props-and-bindings).

Palettes and insertion operations enforce the same group restrictions as runtime validation, including slots nested inside objects, arrays and union branches.

Use `CompositionEditor.renderComponent` to provide host-owned component editors. Its context includes the concrete instance, stable path, rendered element and an `onChange(props)` callback. Updates validate the complete document before committing. A component registered in `forge/RichText` can use any host rich text editor and prop format; Forge provides no fixed rich text document or toolbar.

Use `renderSlot` to customize drop zones. The default canvas provides component insertion points in rendered slots.

See [Reactive Forge](https://github.com/Niikelion/reactive-forge).
