# @reactive-forge/vite

Generate Reactive Forge component metadata and an importable registry during Vite development and production builds. Supports Vite 8 and React 19.

```sh
npm install --save-dev @reactive-forge/vite
```

```ts
// vite.config.ts
import {defineConfig} from "vite"
import {reactiveForge} from "@reactive-forge/vite"

export default defineConfig({
    plugins: [reactiveForge({componentRoots: ["src/components"]})]
})
```

The plugin reads `forge.config.ts` when present. Inline configuration overrides it. Config discovery starts at Vite's project root. Relative extraction paths resolve against the configuration file's directory, or Vite's root when no configuration file exists. Without an explicit TypeScript config, `tsconfig.app.json` is selected when present, otherwise `tsconfig.json`.

Generated files default to `reactive-forge/`, including `metadata.json` and `index.ts`. Import the registry from your application:

```ts
import {components} from "../reactive-forge"
```

Source additions, changes, deletions, annotations and configuration changes regenerate metadata. Vite's existing watcher handles development updates; generated output does not trigger extraction loops. Extraction errors appear in Vite's logger and error overlay. A later valid edit retries generation. Production builds fail when extraction fails.

An optional second argument sets `{configFile: "custom.config.ts", debounceMs: 100}`. Set `configFile: false` to disable config-file discovery. Generation finishes before Vite resolves application imports. The plugin cleans up listeners when the server or build closes.
