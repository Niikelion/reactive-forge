// External identity resolution and library version compatibility - docs/slot-contract.md
// section 5, "Declaration-only exports" and "Library version compatibility".
//
// Never `require`/`import`s the runtime module of the annotated library - every read here is a
// JSON.parse of a package.json or a ts-morph parse of a `.d.ts` file's *type* declarations.

import fs from "fs"
import path from "path"
import { CallExpression, Node, Project } from "ts-morph"
import semver from "semver"
import { ComponentData } from "../types.js"
import { Diagnostic } from "../metadataTypes.js"
import { extractExternalComponentData } from "../extract.js"
import type {ClassExtractionOptions} from "../classBindings.js"
import { shortHash } from "../hash.js"
import { ExternalComponentIdentity, ExternalLibraryRef, LibraryAnnotationSource, SlotRule } from "../slotTypes.js"
import { AuthoredRule } from "./merge.js"
import { parseDefineComponentMetadataCall } from "./parseRules.js"

interface PackageJson {
    name?: string
    version?: string
    types?: string
    typings?: string
    exports?: Record<string, unknown> | string
}

function readPackageJson(packageDir: string): PackageJson | undefined {
    const packageJsonPath = path.join(packageDir, "package.json")
    if (!fs.existsSync(packageJsonPath)) return undefined
    try {
        return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PackageJson
    } catch {
        return undefined
    }
}

// Walks upward from `startDir` looking for `node_modules/<packageSpecifier>` - the same directory
// walk Node's own module resolution performs, without ever `require`-ing anything found.
function resolvePackageDir(startDir: string, packageSpecifier: string): string | undefined {
    let dir = path.resolve(startDir)
    for (;;) {
        const candidate = path.join(dir, "node_modules", ...packageSpecifier.split("/"))
        if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
        const parent = path.dirname(dir)
        if (parent === dir) return undefined
        dir = parent
    }
}

function resolveDtsPath(packageDir: string, packageJson: PackageJson, subpath: string | undefined): string | undefined {
    const key = subpath ? `./${subpath.replace(/^\/+/, "")}` : "."
    if (packageJson.exports && typeof packageJson.exports === "object") {
        const entry = packageJson.exports[key]
        if (entry && typeof entry === "object") {
            const types = (entry as Record<string, unknown>)["types"]
            if (typeof types === "string") return path.resolve(packageDir, types)
        }
        if (typeof entry === "string" && entry.endsWith(".d.ts")) return path.resolve(packageDir, entry)
    }
    if (!subpath) {
        const declared = packageJson.types ?? packageJson.typings
        if (declared) return path.resolve(packageDir, declared)
    }
    // Fall back to a conventional `<subpath>.d.ts` when no exports map resolved it.
    if (subpath) {
        const guess = path.resolve(packageDir, `${subpath.replace(/^\/+/, "")}.d.ts`)
        if (fs.existsSync(guess)) return guess
    }
    return undefined
}

export interface ExternalResolutionResult {
    libraryRefs: ExternalLibraryRef[]
    externalComponents: Map<string, ComponentData & { external: ExternalComponentIdentity }>
    rules: AuthoredRule[]
}

interface ParsedLibraryEntry {
    identity: ExternalComponentIdentity | undefined
    rules: SlotRule[]
    diagnostics: Diagnostic[]
    location: Diagnostic["location"]
}

function findLibraryMetadataDefaultExportCall(project: Project, absoluteModulePath: string): CallExpression | undefined {
    const sourceFile = project.getSourceFile(absoluteModulePath) ?? project.addSourceFileAtPathIfExists(absoluteModulePath)
    if (!sourceFile) return undefined

    const defaultExportSymbol = sourceFile.getDefaultExportSymbol()
    if (!defaultExportSymbol) return undefined

    for (const declaration of defaultExportSymbol.getDeclarations()) {
        // `export default defineLibraryMetadata({...})`
        if (Node.isExportAssignment(declaration)) {
            const expr = declaration.getExpression()
            if (Node.isCallExpression(expr)) return expr
        }
        // `const x = defineLibraryMetadata({...}); export default x;`
        if (Node.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer()
            if (initializer && Node.isCallExpression(initializer)) return initializer
        }
    }
    return undefined
}

export function resolveLibraryAnnotationSources(
    project: Project,
    libraries: LibraryAnnotationSource[],
    rootDir: string,
    projectRoot: string,
    classOptions: ClassExtractionOptions = {}
): ExternalResolutionResult {
    const result: ExternalResolutionResult = { libraryRefs: [], externalComponents: new Map(), rules: [] }

    for (const library of libraries) {
        const diagnostics: Diagnostic[] = []
        const absoluteModulePath = path.resolve(projectRoot, library.metadataModule)
        const call = findLibraryMetadataDefaultExportCall(project, absoluteModulePath)

        let compatibleVersions = "*"
        const entries: ParsedLibraryEntry[] = []

        if (!call) {
            diagnostics.push({
                severity: "error",
                code: "unsupported-annotation-expression",
                message: `Could not find a static "export default defineLibraryMetadata(...)" call in ${absoluteModulePath.replace(/\\/g, "/")}`
            })
        } else {
            const configArg = call.getArguments()[0]
            if (configArg && Node.isObjectLiteralExpression(configArg)) {
                const compatProp = configArg.getProperty("compatibleVersions")
                if (compatProp && Node.isPropertyAssignment(compatProp)) {
                    const initializer = compatProp.getInitializer()
                    if (initializer && (Node.isStringLiteral(initializer) || Node.isNoSubstitutionTemplateLiteral(initializer)))
                        compatibleVersions = initializer.getLiteralValue()
                }
                const componentsProp = configArg.getProperty("components")
                if (componentsProp && Node.isPropertyAssignment(componentsProp)) {
                    const initializer = componentsProp.getInitializer()
                    if (initializer && Node.isArrayLiteralExpression(initializer)) {
                        for (const element of initializer.getElements()) {
                            if (!Node.isCallExpression(element)) continue
                            const parsed = parseDefineComponentMetadataCall(element, { rootDir })
                            if (!parsed) continue
                            entries.push({
                                identity: parsed.identity?.source === "external" ? parsed.identity : undefined,
                                rules: parsed.rules,
                                diagnostics: parsed.diagnostics,
                                location: parsed.location
                            })
                        }
                    }
                }
            }
        }

        const packageDir = resolvePackageDir(path.dirname(absoluteModulePath), library.package) ??
            resolvePackageDir(rootDir, library.package)
        let resolvedVersion: string | undefined
        let packageJson: PackageJson | undefined

        if (!packageDir) {
            diagnostics.push({ severity: "error", code: "library-not-found", message: `Could not resolve package "${library.package}" from node_modules` })
        } else {
            packageJson = readPackageJson(packageDir)
            resolvedVersion = packageJson?.version
            if (resolvedVersion === undefined) {
                diagnostics.push({ severity: "error", code: "library-not-found", message: `Package "${library.package}" has no readable version in its package.json` })
            } else if (semver.validRange(compatibleVersions) === null) {
                diagnostics.push({ severity: "error", code: "library-version-incompatible", message: `compatibleVersions "${compatibleVersions}" is not a valid semver range` })
            } else if (!semver.satisfies(resolvedVersion, compatibleVersions)) {
                diagnostics.push({
                    severity: "error",
                    code: "library-version-incompatible",
                    message: `Resolved ${library.package}@${resolvedVersion} does not satisfy required range "${compatibleVersions}"`
                })
            }
        }

        const libraryUsable = packageDir !== undefined && packageJson !== undefined &&
            resolvedVersion !== undefined && !diagnostics.some(d => d.code === "library-version-incompatible")

        if (libraryUsable && packageDir && packageJson) {
            for (const entry of entries) {
                diagnostics.push(...entry.diagnostics)
                if (!entry.identity) continue

                const dtsPath = resolveDtsPath(packageDir, packageJson, entry.identity.subpath)
                const componentData = dtsPath ? extractExternalComponentData(project, dtsPath, entry.identity.exportName, entry.identity.isDefault, classOptions) : null

                if (!componentData) {
                    diagnostics.push({
                        severity: "error",
                        code: "external-export-missing",
                        message: `Export "${entry.identity.exportName}" was not found in ${library.package}${entry.identity.subpath ? `/${entry.identity.subpath}` : ""}'s declared types (${dtsPath?.replace(/\\/g, "/") ?? "no .d.ts resolved"})`,
                        location: entry.location
                    })
                    continue
                }

                const id = shortHash(`external\0${entry.identity.package}\0${entry.identity.subpath ?? ""}\0${entry.identity.exportName}`)
                const key = id
                const existing = result.externalComponents.get(key)
                if (!existing) {
                    result.externalComponents.set(key, { ...componentData, external: entry.identity })
                }
                for (const rule of entry.rules) result.rules.push({ rule, layer: "library", location: entry.location, componentId: id })
            }
        }

        result.libraryRefs.push({
            package: library.package,
            compatibleVersions,
            ...(resolvedVersion !== undefined ? { resolvedVersion } : {}),
            diagnostics
        })
    }

    return result
}
