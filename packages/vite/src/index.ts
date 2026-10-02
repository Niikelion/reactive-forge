import {createGenerationService} from "@reactive-forge/codegen"
import type {ForgeConfig, GenerationService} from "@reactive-forge/codegen"
import {existsSync} from "node:fs"
import path from "node:path"
import type {Plugin, ViteDevServer} from "vite"

export interface ReactiveForgeOptions {
    /** Explicit config file, resolved relative to Vite's root. Defaults to forge.config.ts. */
    configFile?: string | false
    debounceMs?: number
}

/** Extracts the component registry before Vite resolves imports, and updates it during development. */
export function reactiveForge(config: ForgeConfig = {}, options: ReactiveForgeOptions = {}): Plugin {
    let service: GenerationService | undefined
    let servicePromise: Promise<GenerationService> | undefined
    let server: ViteDevServer | undefined
    let root = process.cwd()
    let defaultTsConfigFilePath: string | undefined
    let initialGeneration: Promise<void> | undefined
    let unsubscribe: (() => void) | undefined

    const getService = async () => {
        servicePromise ??= createGenerationService(config, {
            projectRootDir: root,
            configFile: options.configFile,
            debounceMs: options.debounceMs,
            defaultTsConfigFilePath,
            onError(error) {
                if (!server) return
                server.config.logger.error(`[reactive-forge] ${error.message}`)
                server.ws.send({type: "error", err: {message: error.message, stack: error.stack ?? "", plugin: "reactive-forge"}})
            },
            onGenerated() {
                if (server && service) server.watcher.add(service.watchPaths)
            }
        })
        service = await servicePromise
        return service
    }

    const generate = async () => {
        initialGeneration ??= (async () => {
            await (await getService()).generate()
        })()
        await initialGeneration
    }

    const dispose = async () => {
        unsubscribe?.()
        unsubscribe = undefined
        await (await servicePromise)?.close()
        service = undefined
        servicePromise = undefined
        initialGeneration = undefined
        server = undefined
    }

    return {
        name: "reactive-forge",
        enforce: "pre",
        configResolved(resolved) {
            root = resolved.root
            defaultTsConfigFilePath = existsSync(path.join(root, "tsconfig.app.json")) ? "tsconfig.app.json" : undefined
        },
        async buildStart() {
            await generate()
        },
        async configureServer(devServer) {
            server = devServer
            await generate()
            const generation = await getService()
            // Reuse Vite's watcher: never start a second filesystem watcher.
            server.watcher.add(generation.watchPaths)
            const changed = (file: string) => { generation.invalidate(file) }
            server.watcher.on("add", changed).on("change", changed).on("unlink", changed)
            unsubscribe = () => {
                devServer.watcher.off("add", changed).off("change", changed).off("unlink", changed)
            }
        },
        async closeBundle() {
            await dispose()
        }
    }
}

export default reactiveForge
