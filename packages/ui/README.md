# @reactive-forge/ui

UI part of the Reactive Forge.

## Getting started

To start using the ui, you need to provide some components.
To do that, you can use `ComponentLibraryProvider` component:

```typescript jsx
import {components} from "path/to/reactive-forge/generated/folder";
import {ComponentLibraryProvider} from "@reactive-forge/ui";
import React, {ReactNode} from "react";

export const ComponentProvider: FC<{ children?: ReactNode }> = ({children}) =>
    <ComponentLibraryProvider components={components}>
        {children}
    </ComponentLibraryProvider>
```

## Rendering components

`ComponentRenderer` is responsible for rendering components.
To use it, you need to provide file path, component name, args and context, either by provider:

```typescript jsx
import {ComponentRenderer, ComponentContext, ComponentContextProvider, useComponentLibrary} from "@reactive-forge/ui";
import {useMemo} from "react";

const Empty: FC = () => {
    const library = useComponentLibrary()
    const context = useMemo(() => new ComponentContext(library), [library])
    
    return <ComponentContextProvider context={context}>
        <ComponentRenderer path="$" name="Empty" args={{}}/>
    </ComponentContextProvider>
}
```

or parameter:

```typescript jsx
import {ComponentRenderer, ComponentContext, ComponentContextProvider, useComponentLibrary} from "@reactive-forge/ui";
import {useMemo} from "react";

const Empty: FC = () => {
    const library = useComponentLibrary()
    const context = useMemo(() => new ComponentContext(library), [library])
    
    return <ComponentRenderer context={context} path="$" name="Empty" args={{}}/>
}
```

`ComponentRenderer` checks the type of `args` before rendering the component, to ensure type safety.

## Constructing values

If you tried to pass some arguments you may have noticed,
that it accepts typed wrappers around values instead of plain js values.

They are called `constructs`. Constructs carry type information with them and can be easily serialized to and from the json files.
To make working with them easier, there exists utils object `c`:

```typescript
import { c } from "@reactive-forge/ui";

const numberConstruct = c.number(5)
const stringConstruct = c.string("test")
const objectConstruct = c.object({
    key: c.string("key"),
    value: c.date(new Date())
})

```

You can also load values from file:

```typescript
import {constructSchema} from "@reactive-forge/ui";
import fs from "fs";

const content = JSON.parse(fs.readFileSync("someFile.json", { encoding: 'utf-8' }).toString())
const value = constructSchema.value.safeParse(content)

if (!value.success)
    throw new Error("error")

console.log(value.data)
```

And then pass them to the renderer:

```typescript jsx
import {ComponentRenderer} from "@reactive-forge/ui";

<ComponentRenderer path="@/Text" name="Title" args={{ title: c.string("some text") }} />
```

## Editor

Reactive Forge also provides utilities for creating ui for building these constructs.
Basic editor example using `useComponentPreview` looks like this:

```typescript jsx
import {ComponentRenderer, useComponentPreview} from "@reactive-forge/ui";

const Preview: FC<{ path: string, name: string }> = ({path, name}) => {
    const preview = useComponentPreview(path, name)

    // preview will be null when component is not found
    if (!preview) return null

    // rendererProps may be null when props are invalid
    const {editorProps, rendererProps} = preview

    return <div>
        <Construct {...editorProps} />
        {rendererProps && <ComponentRenderer {...rendererProps} />}
    </div>
}
```

Built-in ui is pretty basic, but you can customize it by providing your own input components with `EditorComponentsProvider`:

```typescript jsx
import {EditorComponentsProvider} from "@reactive-forge/ui";
import React, {ReactNode} from "react";

const CustomEditorComponents: FC<{ children?: ReactNode }> = ({ children }) =>
    <EditorComponentsProvider value={{
        NullInput: YourNullInput,
        UndefinedInput: YourUndefinedInput,
        TextInput: YourTextInput,
        ...
    }}>
        {children}
    </EditorComponentsProvider>
```