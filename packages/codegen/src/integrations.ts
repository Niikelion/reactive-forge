import path from "node:path"
import fs from "node:fs/promises"
import {createRequire} from "node:module"
import {Script} from "node:vm"
import {build} from "esbuild"
import {watch, type FSWatcher} from "chokidar"
import ts from "typescript"
import {createCodegen, fillConfig, type CodegenConfig, type ForgeConfig} from "./index.js"
import {createLogger} from "./utils.js"

export interface GenerationServiceOptions {
    projectRootDir?: string
    /** Defaults to forge.config.ts if it exists. Explicit paths must exist. */
    configFile?: string | false
    /** Framework fallback, used only when neither config file nor inline config specifies one. */
    defaultTsConfigFilePath?: string
    debounceMs?: number
    onError?: (error: Error) => void
    onGenerated?: () => void
}

export interface GenerationService {
    readonly config: CodegenConfig
    readonly watchPaths: readonly string[]
    generate(): Promise<void>
    invalidate(file: string): void
    flush(): Promise<void>
    isRelevant(file: string): boolean
    /** Start watching without running an additional initial generation. */
    watch(): Promise<void>
    close(): Promise<void>
}

const ignoredDirectories = new Set(["node_modules", ".git", ".next", ".nuxt", ".turbo", "dist", "build", "coverage"])
const inside = (file: string, directory: string) => {
    const relative = path.relative(directory, file)
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

/** Shared lifecycle for CLI/framework adapters. Every run creates a fresh extraction project. */
export async function createGenerationService(
    overrides: ForgeConfig = {},
    options: GenerationServiceOptions = {}
): Promise<GenerationService> {
    const projectRoot = path.resolve(options.projectRootDir ?? process.cwd())
    const configFile = path.resolve(projectRoot, typeof options.configFile === "string" ? options.configFile : "forge.config.ts")
    let config = fillConfig(overrides, projectRoot)
    let dependencies = new Set<string>(options.configFile === false ? [] : [configFile])
    let sourceDependencies: string[] = []
    let watcher: FSWatcher | undefined
    let watchedPaths = new Set<string>()
    let closed = false
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let running: Promise<void> | undefined

    function externalInputs(): string[] {
        return [
            ...dependencies, ...sourceDependencies, config.tsConfigFilePath, ...config.componentRoots,
            ...(config.annotationSources?.overrideSources ?? []),
            ...(config.annotationSources?.libraries?.map(source => source.metadataModule) ?? [])
        ]
    }

    async function reloadConfig() {
        let data: ForgeConfig = {}
        const inputs = new Set<string>(options.configFile === false ? [] : [configFile])
        const hasConfig = options.configFile !== false && await exists(configFile)
        if (hasConfig) {
            const bundled = await build({
                entryPoints: [configFile], bundle: true, write: false,
                platform: "node", format: "cjs", packages: "external", metafile: true,
                absWorkingDir: path.dirname(configFile), logLevel: "silent"
            })
            const module: {exports: unknown} = {exports: {}}
            const output = bundled.outputFiles[0]
            if (!output) throw new Error(`Could not compile config at ${configFile}`)
            // Config files are executable user code, like framework config files.
            // Bundle afresh to avoid stale require/import caches on config edits.
            const evaluate = new Script(`(function(require, module, exports, __dirname, __filename) {${output.text}\n})`, {filename: configFile}).runInThisContext() as (
                require: ReturnType<typeof createRequire>, module: {exports: unknown},
                exports: unknown, directory: string, filename: string
            ) => void
            evaluate(createRequire(configFile), module, module.exports, path.dirname(configFile), configFile)
            const exports = module.exports
            const value = exports !== null && typeof exports === "object" && Object.hasOwn(exports, "default")
                ? (exports as Record<string, unknown>)["default"] : exports
            if (value === null || typeof value !== "object" || Array.isArray(value) ||
                Object.getPrototypeOf(value) !== Object.prototype) {
                throw new Error(`Forge config at ${configFile} must export a plain configuration object`)
            }
            data = value as ForgeConfig
            for (const input of Object.keys(bundled.metafile.inputs)) inputs.add(path.resolve(path.dirname(configFile), input))
        } else if (typeof options.configFile === "string") throw new Error(`Could not load config at ${configFile}`)
        const next = fillConfig({tsConfigFilePath: options.defaultTsConfigFilePath, ...data, ...overrides}, hasConfig ? path.dirname(configFile) : projectRoot)
        const visitTsconfig = (file: string) => {
            if (inputs.has(file)) return
            inputs.add(file)
            const parsed = ts.readConfigFile(file, fileName => ts.sys.readFile(fileName)).config as {extends?: string | string[]} | undefined
            for (const extension of typeof parsed?.extends === "string" ? [parsed.extends] : parsed?.extends ?? []) {
                try {
                    let parent: string
                    if (extension.startsWith(".") || path.isAbsolute(extension)) {
                        parent = path.resolve(path.dirname(file), extension)
                        if (!path.extname(parent)) parent += ".json"
                    } else parent = createRequire(file).resolve(extension)
                    visitTsconfig(parent)
                } catch { /* TypeScript reports unresolved configurations during extraction. */ }
            }
        }
        visitTsconfig(next.tsConfigFilePath)
        config = next
        dependencies = inputs
        updateWatcher()
    }

    function updateWatcher() {
        if (!watcher) return
        const next = new Set([config.rootDir, ...externalInputs()])
        watcher.add([...next].filter(file => !watchedPaths.has(file)))
        watcher.unwatch([...watchedPaths].filter(file => !next.has(file)))
        watchedPaths = next
    }

    function ignored(file: string): boolean {
        const absolute = path.resolve(file)
        if (inside(absolute, config.outDir)) return true
        if (externalInputs().some(input => absolute === input || inside(input, absolute))) return false
        return absolute.split(path.sep).some(part => ignoredDirectories.has(part))
    }

    function isRelevant(file: string): boolean {
        const absolute = path.resolve(projectRoot, file)
        if (ignored(absolute)) return false
        return dependencies.has(absolute) || absolute === config.tsConfigFilePath ||
            externalInputs().some(input => absolute === input || inside(absolute, input)) ||
            (inside(absolute, config.rootDir) && /\.(?:[cm]?[jt]sx?|json)$/.test(absolute))
    }

    function report(error: unknown) {
        const actual = error instanceof Error ? error : new Error(String(error))
        if (options.onError) options.onError(actual)
        else console.error("[reactive-forge]", actual.message)
    }

    async function drain(): Promise<void> {
        if (closed) return
        if (running) return running
        running = (async () => {
            let failure: Error | undefined
            const shouldRun = () => pending && !closed
            while (shouldRun()) {
                pending = false
                try {
                    await reloadConfig()
                    await createCodegen(config, createLogger({silent: true}), {
                        onSourceFiles(files) {
                            sourceDependencies = files.map(file => path.resolve(file)).filter(file => !inside(file, config.outDir) &&
                                !file.split(path.sep).some(part => ignoredDirectories.has(part)))
                        }
                    })
                    updateWatcher()
                    options.onGenerated?.()
                    failure = undefined
                } catch (error) { failure = error instanceof Error ? error : new Error(String(error)) }
            }
            if (failure !== undefined) throw failure
        })()
        try { await running } finally { running = undefined }
    }

    const service: GenerationService = {
        get config() { return config },
        get watchPaths() { return [config.rootDir, ...externalInputs()] },
        isRelevant,
        async generate() {
            if (closed) throw new Error("Generation service is closed")
            pending = true
            await service.flush()
        },
        invalidate(file) {
            if (closed || !isRelevant(file)) return
            pending = true
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                timer = undefined
                void drain().catch(report)
            }, options.debounceMs ?? 75)
        },
        async flush() {
            if (timer) clearTimeout(timer)
            timer = undefined
            await drain()
        },
        async watch() {
            if (closed) throw new Error("Generation service is closed")
            if (watcher) return
            watchedPaths = new Set([config.rootDir, ...externalInputs()])
            watcher = watch([...watchedPaths], {
                persistent: false, ignoreInitial: true, ignored,
                awaitWriteFinish: {stabilityThreshold: 100, pollInterval: 25}
            })
            const invalidate = (file: string) => { service.invalidate(file) }
            watcher.on("add", invalidate).on("change", invalidate).on("unlink", invalidate)
            watcher.on("error", report)
            await new Promise<void>(resolve => watcher?.once("ready", resolve))
        },
        async close() {
            closed = true
            pending = false
            if (timer) clearTimeout(timer)
            timer = undefined
            await watcher?.close()
            await running?.catch(() => undefined)
        }
    }
    await reloadConfig()
    return service
}

async function exists(file: string): Promise<boolean> {
    try { await fs.access(file); return true } catch { return false }
}
