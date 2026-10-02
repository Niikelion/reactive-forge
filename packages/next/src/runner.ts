import path from "node:path"
import {createRequire} from "node:module"
import {spawn, spawnSync} from "node:child_process"
import {createGenerationService, type ForgeConfig} from "@reactive-forge/codegen"
import type {ReactiveForgeNextOptions} from "./index.js"

export interface RunNextOptions extends ReactiveForgeNextOptions {
    config?: ForgeConfig
}

/** Runs the project's installed Next CLI, with one generation owner per process. */
export async function runNext(command: "dev" | "build", args: string[] = [], options: RunNextOptions = {}): Promise<number> {
    let root = path.resolve(options.projectRootDir ?? process.cwd())
    if (args[0] !== undefined && !args[0].startsWith("-")) {
        root = path.resolve(root, args[0])
        args = args.slice(1)
    }
    const require = createRequire(path.join(root, "package.json"))
    const nextBin = require.resolve("next/dist/bin/next")
    const service = await createGenerationService(options.config ?? {}, {
        ...options,
        projectRootDir: root,
        onError: (error: unknown) => { console.error("[reactive-forge]", error) }
    })
    try {
        if (command === "dev") await service.watch()
        await service.generate()
        const child = spawn(process.execPath, [nextBin, command, ...args], {
            cwd: root,
            stdio: "inherit",
            env: {...process.env, REACTIVE_FORGE_NEXT_ROOT: root}
        })
        const stop = (signal: "SIGINT" | "SIGTERM") => {
            // Windows has no POSIX signal forwarding. Next dev owns a worker process,
            // so terminate its tree rather than leaving a detached development server.
            if (process.platform === "win32" && child.pid !== undefined) {
                const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {encoding: "utf8", windowsHide: true})
                if (result.status !== 0) {
                    console.error("[reactive-forge] Could not stop Next process tree:", result.error ?? result.stderr)
                    child.kill(signal)
                }
            } else child.kill(signal)
        }
        const interrupt = () => { stop("SIGINT") }
        const terminate = () => { stop("SIGTERM") }
        process.on("SIGINT", interrupt)
        process.on("SIGTERM", terminate)
        try {
            return await new Promise<number>((resolve, reject) => {
                child.once("error", reject)
                child.once("exit", (code, signal) => { resolve(code ?? (signal === "SIGINT" ? 130 : 143)) })
            })
        } finally {
            process.off("SIGINT", interrupt)
            process.off("SIGTERM", terminate)
        }
    } finally { await service.close() }
}
