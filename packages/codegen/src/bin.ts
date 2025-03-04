#!/usr/bin/env node

import prompts from "prompts"
import colors from "kleur"
import { Command } from "@commander-js/extra-typings"

const program = new Command()
import { version } from "../package.json"
import dedent from "dedent"
import path from "path"
import fs from "fs/promises"
import {createCodegen, fillConfig, ForgeConfig} from "./index"
import {createLogger} from "./utils";

program.name("forge").version(version)

program
    .command("init")
    .description("Initializes reactive-forge for current project")
    .option("-s, --silent", "Disables logging except errors", false)
    .action(async (options) => {
        const logger = createLogger({
            silent: options.silent,
            prefix: false
        })

        const response = await prompts([
            {
                type: "text",
                name: "rootDir",
                message: "Where is the root of your project?",
                initial: "."
            },
            {
                type: "text",
                name: "baseDir",
                message: "What is the base directory containing all your components?",
                initial: "src"
            },
            {
                type: "list",
                name: "componentRoots",
                message: "Specify source directories of components or leave empty to look for them in base directory."
            },
            {
                type: "text",
                name: "tsConfigFilePath",
                message: "Where is your tsconfig.json file located?",
                initial: "tsconfig.json"
            },
            {
                type: "text",
                name: "outDir",
                message: "Where should generated files be placed?",
                initial: "reactive-forge"
            },
            {
                type: "text",
                name: "pathPrefix",
                message: "How do you want to prefix your component files?",
                initial: "@/"
            },
            {
                type: "toggle",
                name: "usesWorkspaces",
                message: "Do you use workspaces?",
                active: "yes",
                inactive: "no",
                initial: false
            },
            {
                type: prev => prev ? "text" : null,
                name: "typescriptLibPath",
                message: "Where is lib folder of typescript package located?",
                initial: "./node_modules/typescript/lib"
            },
            {
                type: prev => prev ? "text" : null,
                name: "reactTypesFilePath",
                message: "Where is index.d.ts file of react types located?",
                initial: "./node_modules/@types/react/index.d.ts"
            }
        ])

        const { usesWorkspaces: _, ...rest } = response

        const config: ForgeConfig = rest

        if (config.componentRoots !== undefined) {
            config.componentRoots = config.componentRoots.filter(r => r.length > 0)
            if (config.componentRoots.length === 0) {
                delete config.componentRoots
            }
        }

        const { shouldSave } = await prompts({
            type: "confirm",
            name: "shouldSave",
            message: "Do you want to save this config?"
        })

        if (!shouldSave) {
            console.info(config)
            return
        }

        const configContentPrefix = dedent`
            import type { ForgeConfig } from "@reactive-forge/codegen"
            
            export default {
        `

        const configContentSuffix = dedent`
            } satisfies ForgeConfig
        `

        const configContentProps = [
            "rootDir",
            "baseDir",
            "componentRoots",
            "tsConfigFilePath",
            "outDir",
            "pathPrefix",
            "typescriptLibPath",
            "reactTypesFilePath"
        ].filter(p => p in config).map(p => {
            const value = config[p as keyof ForgeConfig]
            return `\t${p}: ${JSON.stringify(value)}`
        }).join(",\n")

        const rootPath = config.rootDir ?? "./"
        const configPath = path.resolve(rootPath, "forge.config.ts")
        const configContent = [configContentPrefix, configContentProps, configContentSuffix].join("\n")

        logger.info(`Writing ${colors.yellow().dim("forge.config.ts")}`)
        await fs.writeFile(configPath, configContent)

        logger.info(`Now you can add ${colors.yellow().dim(`forge &&`)} before your dev and build command in your ${colors.yellow().dim("package.json")}`)

        logger.info("Finished!", true)
    })
program
    .command("codegen", { isDefault: true })
    .description("Generates component wrappers with type information")
    .option("--config <path>", "location to config file")
    .option("-s, --silent", "Disables logging except errors", false)
    .action(async (options) => {
        const logger = createLogger({
            silent: options.silent,
            prefix: true
        })
        const { loadConfig } = await import("load-config-ts")

        const configFile = options.config ?? "./forge.config.ts"
        const config = await loadConfig<ForgeConfig>({
            cwd: process.cwd(),
            configKey: "forge",
            configFile
        })

        if (config.path === undefined) {
            logger.error(`Could not load config${options.config !== undefined ? ` at ${configFile}` : ""}`)
            return
        }

        await createCodegen(fillConfig(config.data), logger)
    })
program.helpCommand(true)

program.parseAsync().catch(console.error)