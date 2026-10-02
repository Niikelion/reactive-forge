#!/usr/bin/env node
import {runNext} from "./runner.js"

const [command, ...args] = process.argv.slice(2)
const usage = "Usage: forge-next <dev|build> [directory] [Next options] [--forge-config path] [--forge-root path]"
const options: {projectRootDir?: string; configFile?: string} = {}
for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === "--forge-root" || flag === "--forge-config") {
        const value = args[i + 1]
        if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a path`)
        if (flag === "--forge-root") options.projectRootDir = value
        else options.configFile = value
        args.splice(i, 2)
        i--
    }
}
if (command === "--help" || command === "-h") {
    console.info(usage)
} else if (command !== "dev" && command !== "build") {
    console.error(usage)
    process.exitCode = 1
} else {
    runNext(command, args, options).then(code => {process.exitCode = code}).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
}
