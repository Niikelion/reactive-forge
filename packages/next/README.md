# @reactive-forge/next

Generate a component registry and portable props metadata in Next.js 16 applications, with Turbopack or Webpack. Requires Node.js 20.9+ and React 19.

Install `@reactive-forge/next` and configure extraction in `forge.config.ts` using `ForgeConfig` from `@reactive-forge/codegen`.

```json
{"scripts": {"dev": "forge-next dev", "build": "forge-next build", "start": "next start"}}
```

The CLI generates before starting Next. Development watches source, annotations and config through the shared codegen service, regenerates on changes, and closes its watcher when Next exits. Next observes the generated files normally; no Webpack plugin is injected. Pass Next's normal flags, including `--webpack`, `--port` or `--hostname`. Run from the application directory, put its directory immediately after `dev`/`build` (for example `forge-next dev apps/site --port 3001`), or use `--forge-root path`. `--forge-config path` selects an alternate Forge config.

For one-shot generation when using Next directly, wrap your Next config:

```ts
import {withReactiveForge} from "@reactive-forge/next"
export default withReactiveForge()({reactStrictMode: true})
```

The wrapper also accepts an async Next config function and preserves its result and hooks. It generates during development or production-build config phases only, closes its service immediately, and does not watch. Use the CLI for continuous development generation. Do not combine explicit inline Forge config in the wrapper with CLI generation: put shared settings in `forge.config.ts`. When run through the CLI the wrapper skips duplicate generation. `next start` and unrelated config phases do not generate.

Next's `typegen` command also loads the production-build config phase, so the wrapper can generate during `next typegen`; use the CLI without the wrapper if this is unwanted.
