// Colocated discovery - docs/slot-contract.md section 5, "Annotation source discovery":
// `defineComponentMetadata` calls found in the same source file as an already-extracted
// component, or in a same-named `*.metadata.ts` sibling file. Also covers `overrideSources`
// (project-root-relative paths to a module whose default export is a SlotRule[]-bearing
// `defineComponentMetadata` list - the "project override" layer).
//
// Scoped to `componentRoots` (already-configured, already-trusted project source) per the
// contract: "the one place a scan happens at all." `libraries`/`overrideSources` never get
// scanned by naming convention - see external.ts.

import path from "path"
import {shortHash} from "../hash.js"
import type {AuthoredGroups} from "./groups.js"
import { Node, Project, SourceFile } from "ts-morph"
import { ComponentData } from "../types.js"
import { Diagnostic } from "../metadataTypes.js"
import { AuthoredRule } from "./merge.js"
import { findDefineComponentMetadataCalls, parseDefineComponentMetadataCall } from "./parseRules.js"

// Only a `defineComponentMetadata(...)` call reachable from a top-level exported binding is
// recognized (section 5: "matching how `extractComponents` already only recognizes static,
// value-exported declarations") - a call buried inside an unexported helper or a function body is
// not a static annotation source.
function isReachableFromExportedTopLevelBinding(node: Node): boolean {
    let current: Node | undefined = node
    while (current !== undefined) {
        if (Node.isVariableStatement(current) && current.isExported()) return true
        if (Node.isExportAssignment(current)) return true
        if (Node.isSourceFile(current)) return false
        current = current.getParent()
    }
    return false
}

export interface ColocatedDiscoveryResult {
    rules: AuthoredRule[]
    groups: AuthoredGroups[]
    // Diagnostics from calls that could not be matched to any known component identity, or whose
    // own parse produced warnings, keyed by the project component id they targeted (when
    // resolvable) so the caller can fold them into that component's ComponentMetadata.diagnostics.
    diagnosticsByComponentId: Map<string, Diagnostic[]>
    unmatchedDiagnostics: Diagnostic[]
}

function metadataSiblingPath(sourcePath: string): string {
    return sourcePath.replace(/\.(tsx?|jsx?)$/i, ".metadata.ts")
}

function collectCallsFromFile(sourceFile: SourceFile, layer: "library" | "project", rootDir: string, result: ColocatedDiscoveryResult) {
    for (const call of findDefineComponentMetadataCalls(sourceFile)) {
        if (!isReachableFromExportedTopLevelBinding(call)) continue
        const parsed = parseDefineComponentMetadataCall(call, { rootDir })
        if (!parsed) continue

        if (parsed.identity) {
            const id = parsed.identity.source === "project" ? parsed.identity.id : shortHash(`external\0${parsed.identity.package}\0${parsed.identity.subpath ?? ""}\0${parsed.identity.exportName}`)
            if (parsed.groups !== undefined) result.groups.push({groups: parsed.groups, layer, location: parsed.location, componentId: id})
            for (const rule of parsed.rules)
                result.rules.push({ rule, layer, location: parsed.location, componentId: id })
            if (parsed.diagnostics.length > 0) {
                const existing = result.diagnosticsByComponentId.get(id) ?? []
                result.diagnosticsByComponentId.set(id, [...existing, ...parsed.diagnostics])
            }
        } else {
            result.unmatchedDiagnostics.push(...parsed.diagnostics)
        }
    }
}

export function discoverColocatedAnnotations(project: Project, components: ComponentData[], rootDir: string): ColocatedDiscoveryResult {
    const result: ColocatedDiscoveryResult = { rules: [], groups: [], diagnosticsByComponentId: new Map(), unmatchedDiagnostics: [] }

    const scannedFiles = new Set<string>()
    for (const component of components) {
        const sourceFile = project.getSourceFile(component.sourcePath)
        if (!sourceFile) continue

        if (!scannedFiles.has(sourceFile.getFilePath())) {
            scannedFiles.add(sourceFile.getFilePath())
            collectCallsFromFile(sourceFile, "library", rootDir, result)
        }

        const siblingPath = metadataSiblingPath(component.sourcePath)
        if (!scannedFiles.has(siblingPath)) {
            const siblingFile = project.getSourceFile(siblingPath) ?? project.addSourceFileAtPathIfExists(siblingPath)
            scannedFiles.add(siblingPath)
            if (siblingFile) collectCallsFromFile(siblingFile, "library", rootDir, result)
        }
    }

    return result
}

// Project override sources (section 5's `overrideSources: string[]`): project-root-relative paths
// to a module whose default export is a `SlotRule[]`-bearing `defineComponentMetadata` list - the
// same static-analysis approach, at the "project" layer.
export function discoverOverrideAnnotations(project: Project, overrideSources: string[], rootDir: string, projectRoot: string): ColocatedDiscoveryResult {
    const result: ColocatedDiscoveryResult = { rules: [], groups: [], diagnosticsByComponentId: new Map(), unmatchedDiagnostics: [] }

    for (const relativePath of overrideSources) {
        const absolutePath = path.resolve(projectRoot, relativePath)
        const sourceFile = project.getSourceFile(absolutePath) ?? project.addSourceFileAtPathIfExists(absolutePath)
        if (!sourceFile) {
            result.unmatchedDiagnostics.push({
                severity: "error",
                code: "override-source-not-found",
                message: `Could not resolve overrideSources entry "${relativePath}" (looked for ${absolutePath.replace(/\\/g, "/")})`
            })
            continue
        }
        collectCallsFromFile(sourceFile, "project", rootDir, result)
    }

    return result
}
