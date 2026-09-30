# Editing nested slots

`CompositionEditor` from `@reactive-forge/editor` accepts `document`, `metadata`, `library`, and `onChange`. Render `ComponentPalette` with the same metadata alongside it for pointer dragging. Every drop and picker choice is validated before committing, including required component props, nested policies and ancestor collection limits.

The editor decorates the values passed to the actual component: an outlet in `content.header.title` appears where that component renders its title. Arrays retain their separate entry IDs and node lists. Empty node values have insertion targets. Omitted optional top-level ReactNode props also get targets, without changing the saved document until a successful edit. Props with recorded defaults retain their component-provided default behavior.

Supply `createInstance(componentMetadata)` to initialize required props. Returning `undefined` declines insertion; the editor never inserts an invalid placeholder instance. `callbacks` supplies the same host callback registry used by runtime rendering.

## Operations

Use `editValue`, `insertAtValuePath`, `removeAtValuePath`, `moveAtValuePath`, and `insertArrayEntryAtPath` for policy-aware nested edits. They return `{ok, document}` plus diagnostics/reason on failure. Failed operations retain the original document. A `ValuePath` uses prop/field segments and stable `arrayItem`/`slotItem` IDs; indices only specify insertion or destination order.

Legacy `removeSlotItem` and `moveSlotItem` now require `(document, metadata, library, instancePath, propName, ...)` and return the same result type. For declared arrays these operations address whole entries, never a flattened list of their children. Use the nested path APIs to change the nodes within one entry.

Loaded documents reject duplicate sibling item IDs and duplicate instance IDs. This prevents an address from silently selecting the wrong item after reload.

## Rendering adapters and rich text

`renderSlot({path, value, children, outlet})` can replace the default outlet. Use an adapter when a component inspects/clones children or its slot requires special markup (for example direct table rows). Default outlets use flow-content controls and `display: contents`; they are not a universal table/list adapter. Returning `children` leaves that region read-only.

Rich-text outlets edit structured text, bold and italic runs, and supported paragraph/list blocks. Forbidden marks and pasted elements/attributes are rejected. Paste replaces the focused rich-text value; selection-aware rich-text paste and selection-only formatting are future UX refinements. Formatting buttons currently toggle a mark across the value. Runtime rendering and TSX export never include editor controls.

## Local acceptance demo

From the repository root, after `yarn build`:

```powershell
node packages/codegen/dist/bin.js codegen --config tests/fixtures/editor-demo/forge.demo.config.ts
node packages/codegen/dist/bin.js bundle --config tests/fixtures/editor-demo/forge.demo.config.ts
node scripts/build-editor-demo.cjs
node scripts/static-server.cjs tests/fixtures 4600
```

Open `http://localhost:4600/editor-demo/index.html`. The first editor is the nested demo. It supports real pointer drops, keyboard insertion, rich-text editing, array reorder, save/reload, and TSX export. The plain runtime output below it shows the same document without editing markup.

Browser verification performed on 2026-09-28: dragged Greeter into the first section body; edited/bolded the nested title; rejected italic and a Badge drop into a full action entry; moved the second section ahead of the first; saved, reloaded the page and restored the document; exported TSX containing the edited title, reordered sections and inserted Greeter. Automated tests additionally compile exported nested-demo TSX and compare its rendered output with runtime output.

Final gate: 123 strict tests passed (zero failures/skips/TODOs), plus build, typecheck, lint, package exports and `git diff --check`. Use a writable npm cache when package packing runs inside the Windows sandbox.

## Server preview

`Niikelion/reactive-forge-studio` currently contains only its README. A deployed Studio app and self-hosted CI runner have not yet been provisioned. Existing infrastructure names `service-host`; it is online via Tailscale, but SSH as its configured `arthur` account rejected the infrastructure key. The server account/key and preview hostname are needed before provisioning. No server settings or runner registrations were changed.
