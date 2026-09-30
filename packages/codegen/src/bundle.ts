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
// development (see docs/baseline.md "Portable bundle (gate C)").
//
// Image/font assets: closing what was previously a documented gap here
// ("no loader configured, esbuild fails the whole build"). `assetLoaders`
// below maps the common image (`.svg`, `.png`, `.jpg`/`.jpeg`, `.gif`,
// `.webp`) and font (`.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`) extensions to
// esbuild's `"file"` loader, not `"dataurl"`. Reasoning: per
// docs/claude-handoff.md's Goal section, this bundle is not trying to
// minimize its own size or promise that pure component functions get
// isolated from their reachable dependencies - an asset-heavy bundle is
// expected and fine. `"dataurl"` would inline every asset as base64 directly
// inside bundle.js (and inside bundle.css for CSS-referenced assets, e.g.
// `@font-face { src: url(...) }` or a `background-image` url()), which grows
// the *text* size of files a host has to download/parse even when it only
// needs some of the components in the registry, and base64 inflates binary
// payloads ~33%. `"file"` instead copies each asset next to bundle.js under
// a content-hashed name (esbuild's default `assetNames`) and rewrites every
// reference - both plain `import x from "./logo.svg"` and CSS `url(...)` -
// to a relative path pointing at that copy. Verified directly against
// esbuild 0.28.2 during development (not assumed from the docs): CSS
// `url()` references are automatically rewritten to the hashed asset
// filename by esbuild's own CSS loader once `.woff2`/`.svg` are configured
// as `"file"`, with no extra plugin. No extension in `assetLoaders` uses
// `"dataurl"`; if a future caller wants inlining for a specific
// size-sensitive case (e.g. a tiny icon font), that would need a per-call
// override this module doesn't currently expose.
//
// outfile vs outdir: `"file"`-loader output was confirmed (via a throwaway
// esbuild script during development) to work under esbuild's single-file
// `outfile` mode exactly as it does under `outdir` mode - esbuild writes
// the extra asset files into `outfile`'s own directory and rewrites
// references relative to it. `bundleLibrary` therefore keeps using
// `outfile`; existing callers' `bundle.js` path/name behavior is unchanged.
export interface BundleConfig {
    outDir: string
    bundleFileName?: string
}

// esbuild's own loader identifiers - see the module doc comment above for
// why every entry here is "file", not "dataurl".
const assetLoaders: Record<string, "file"> = {
    ".svg": "file",
    ".png": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".gif": "file",
    ".webp": "file",
    ".woff": "file",
    ".woff2": "file",
    ".ttf": "file",
    ".otf": "file",
    ".eot": "file",
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

    let metafile: esbuild.Metafile
    try {
        const result = await esbuild.build({
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
            loader: assetLoaders,
            write: true,
            // Needed to enumerate every file esbuild actually wrote (bundle.js,
            // the optional CSS sibling, and now any "file"-loader asset
            // copies) so bundleLibrary can report/return them - see the
            // metafile.outputs walk below, which replaces the old
            // CSS-only `fs.access` probe.
            metafile: true,
            logLevel: "silent",
        })
        metafile = result.metafile
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

    // Asset files written by the "file" loader (see assetLoaders above) -
    // e.g. a component's `import logo from "./logo.svg"`, or a CSS
    // `url(...)` esbuild's CSS loader rewrote to point at a copied font/image.
    // These land in the same directory as `outfile` under a content-hashed
    // name esbuild chooses; a caller/host needs to know they exist the same
    // way it already needs to know about the CSS sibling above, so they're
    // walked out of the real `metafile.outputs` (every file esbuild actually
    // wrote for this build) rather than re-derived by guessing a naming
    // pattern.
    for (const rawOutputPath of Object.keys(metafile.outputs)) {
        const outputPath = path.resolve(rawOutputPath)
        if (outputPath === outfile || outputPath === cssFile) continue
        logger.info(`Also wrote ${path.relative(process.cwd(), outputPath)} (static asset reached from component imports)`, true)
    }

    return outfile
}
