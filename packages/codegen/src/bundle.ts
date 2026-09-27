import * as esbuild from "esbuild"
import path from "path"
import fs from "fs/promises"
import { Logger } from "./utils.js"

// Gate C: "Prove portable consumption" (docs/claude-handoff.md section C,
// docs/development-plan.md "Proposed architecture"). This module bundles an
// already-generated registry (`<outDir>/index.ts` + its
// `__reactive_forge_files` wrappers, produced by `generateFiles` in
// generate.ts) into a single standalone browser ESM file that an independent
// host can `import()` without ever touching the original project's source,
// ts-morph, typescript, or esbuild itself.
//
// Build path chosen: esbuild's own JS API, called directly (not through a
// wrapping plugin/framework). esbuild is already a hard runtime dependency of
// this package (via `load-config-ts` -> `bundle-require`, see
// docs/baseline.md's "esbuild/load-config-ts dependency gap" note), so this
// adds no new dependency, and it natively supports the exact target this
// gate needs: TypeScript/TSX input, single-file ESM output, explicit
// `external` for host-provided peers. A plugin framework (e.g. Vite's build
// API, Rollup + a TS plugin chain) would pull in far more surface area to
// prove the same one path.
//
// Peer dependencies: react and react-dom are marked `external` so the
// consuming host supplies them (e.g. via an import map to a CDN build, or a
// locally vendored copy) rather than the bundle inlining its own React
// instance - see tests/fixtures/independent-host/.
//
// CSS/assets: esbuild's `bundle: true` has a built-in CSS loader, so a plain
// side-effect `import "./x.css"` reached from the entry point is collected
// and written to a sibling `<bundleFileName minus .js>.css` file automatically
// - no extra configuration needed, verified against a real fixture during
// development (see docs/baseline.md "Portable bundle (gate C)"). Any other
// static asset extension (`.svg`, `.png`, image/font imports, etc.) has no
// loader configured here, so esbuild fails the whole build with its own
// actionable per-file error ("No loader is configured for ... file
// extension"), surfaced below with source context (see the catch block).
// This is a diagnosed limitation, not a silent mishandling: nothing in this
// file attempts to inline, copy, or drop unsupported assets, and no fixture
// component in this gate exercises them, so that path is documented rather
// than "proven".
export interface BundleConfig {
    outDir: string
    bundleFileName?: string
}

// React/ReactDOM plus their common browser ESM subpaths. Marking these
// external (never inlined) is what makes "host-provided React" true instead
// of aspirational - esbuild leaves `import ... from "react"` etc. as literal
// ESM imports in the output file for the host's import map to resolve.
const hostProvidedPeers = [
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom",
    "react-dom/client",
]

export async function bundleLibrary({ outDir, bundleFileName = "bundle.js" }: BundleConfig, logger: Logger): Promise<string> {
    const outputRoot = path.resolve(outDir)
    const entry = path.resolve(outputRoot, "index.ts")
    const outfile = path.resolve(outputRoot, bundleFileName)

    try {
        await fs.access(entry)
    } catch {
        throw new Error(`No generated registry found at ${entry}. Run "forge codegen" before "forge bundle".`)
    }

    try {
        await esbuild.build({
            entryPoints: [entry],
            outfile,
            bundle: true,
            format: "esm",
            platform: "browser",
            target: "es2020",
            // Explicit, not left to esbuild's own tsconfig.json auto-discovery:
            // the generated registry's wrapper files (generate.ts) never
            // import React themselves, so they only produce valid output
            // under the automatic JSX runtime (`react/jsx-runtime`, which is
            // in `hostProvidedPeers` below). Relying on discovery would make
            // bundling correctness depend on whether a `tsconfig.json`
            // happens to be sitting where esbuild looks for one; pinning it
            // here means `forge bundle` behaves the same regardless.
            jsx: "automatic",
            external: hostProvidedPeers,
            write: true,
            logLevel: "silent",
        })
    } catch (error) {
        // esbuild's BuildFailure already carries actionable, file/line-level
        // messages (this is exactly where an unsupported `.css`/asset import
        // surfaces, see the module doc comment above). Re-thrown with a
        // stable prefix so CLI/API callers get a clear, non-silent failure
        // instead of a partially-written or misleading bundle.
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Bundling failed for ${entry}:\n${message}`)
    }

    logger.info(`Bundled ${path.relative(process.cwd(), entry)} -> ${path.relative(process.cwd(), outfile)}`, true)

    const cssFile = outfile.replace(/\.js$/, ".css")
    try {
        await fs.access(cssFile)
        logger.info(`Also wrote ${path.relative(process.cwd(), cssFile)} (CSS reached from component imports)`, true)
    } catch {
        // No CSS was reached from the entry point; nothing to report.
    }

    return outfile
}
