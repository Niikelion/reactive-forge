import path from "node:path"
import {createGenerationService, type ForgeConfig} from "@reactive-forge/codegen"
import type {NextConfig} from "next"

export interface ReactiveForgeNextOptions {
    projectRootDir?: string
    configFile?: string
}

export type NextConfigFactory = (phase: string, context: {defaultConfig: NextConfig}) => NextConfig | Promise<NextConfig>

/** Generates before Next reads the application, independently of its bundler.
 * Use forge-next dev for continuous regeneration and reliable watcher teardown.
 */
export function withReactiveForge(config: ForgeConfig = {}, options: ReactiveForgeNextOptions = {}) {
    const generations = new Map<string, Promise<void>>()
    return (nextConfig: NextConfig | NextConfigFactory = {}): NextConfigFactory => async (phase, context) => {
        const root = path.resolve(options.projectRootDir ?? process.cwd())
        if ((phase === "phase-development-server" || phase === "phase-production-build") &&
            process.env["REACTIVE_FORGE_NEXT_ROOT"] !== root) {
            const key = `${root}:${phase}`
            let generation = generations.get(key)
            if (generation === undefined) {
                generation = (async () => {
                    const service = await createGenerationService(config, {...options, projectRootDir: root})
                    try { await service.generate() } finally { await service.close() }
                })().catch((error: unknown) => { generations.delete(key); throw error })
                generations.set(key, generation)
            }
            await generation
        }
        return typeof nextConfig === "function" ? nextConfig(phase, context) : nextConfig
    }
}

export {runNext} from "./runner.js"
export type {RunNextOptions} from "./runner.js"
