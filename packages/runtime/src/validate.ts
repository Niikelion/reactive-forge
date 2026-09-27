import {
    ComponentLibraryData,
    ComponentMetadata,
    findComponentEntry,
    fromValueJson,
    MetadataDocument,
    registerCommonSchemas,
    schemaFromJson
} from "@reactive-forge/schema"
import {CompositionDocument, CompositionInstance, CompositionNode} from "./composition.js"
import type {CallbackRegistry} from "./render.js"

// schemaFromJson (used below to turn a PropMetadata.schema back into a real
// Schema instance) resolves through a process-global factory registry that
// nothing registers by default - see packages/schema/src/schema/
// commonSchemas.ts. The runtime package is meant to be usable standalone
// (e.g. a browser host that never imports packages/codegen, which is what
// currently calls this), so it registers the common schema types itself,
// once, at module load. Idempotent - safe even if a host also calls it.
registerCommonSchemas()

/**
 * Diagnostic shape for composition-document validation. Deliberately close
 * to `Diagnostic` in packages/schema/src/schema/metadata.ts (same
 * severity/code/message triad, see docs/metadata-contract.md's
 * "Diagnostics"), but `location` (a source-file position) makes no sense for
 * a composition document - `path` (a JSON-pointer-ish string identifying the
 * offending node, e.g. `root.children[0].props.title`) replaces it.
 */
export interface CompositionDiagnostic {
    severity: "error" | "warning"
    code: string
    message: string
    path: string
}

export interface ValidationResult {
    valid: boolean
    diagnostics: CompositionDiagnostic[]
}

function findMetadata(metadata: MetadataDocument, id: string): ComponentMetadata | undefined {
    return metadata.components.find(component => component.id === id)
}

function validateInstance(
    node: CompositionInstance,
    path: string,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry | undefined,
    diagnostics: CompositionDiagnostic[]
): void {
    const componentMeta = findMetadata(metadata, node.id)
    if (componentMeta === undefined) {
        diagnostics.push({severity: "error", code: "unknown-component-id", message: `No component with id "${node.id}" in the metadata document`, path})
        return
    }
    const entry = findComponentEntry(library, node.id)
    if (entry === undefined) {
        diagnostics.push({severity: "error", code: "component-not-registered", message: `No registry entry with id "${node.id}" for component "${componentMeta.name}" (${componentMeta.sourcePath})`, path})
        return
    }

    for (const [propName, propMeta] of Object.entries(componentMeta.props)) {
        if (propName === "children") continue
        const provided = node.props[propName]
        if (provided === undefined) {
            if (propMeta.required)
                diagnostics.push({severity: "error", code: "missing-required-prop", message: `Required prop "${propName}" is missing`, path: `${path}.props.${propName}`})
            continue
        }
        if (provided.kind === "callback") {
            if (propMeta.schema.type !== "function") {
                diagnostics.push({severity: "error", code: "callback-for-non-function-prop", message: `Prop "${propName}" is not function-typed and cannot take a callback reference`, path: `${path}.props.${propName}`})
                continue
            }
            if (callbacks !== undefined && !(provided.name in callbacks)) {
                diagnostics.push({severity: "error", code: "unresolved-callback", message: `Callback reference "${provided.name}" for prop "${propName}" is not present in the host callback registry`, path: `${path}.props.${propName}`})
            }
        } else {
            try {
                const schema = schemaFromJson(propMeta.schema)
                fromValueJson(schema, provided.value)
            } catch (error) {
                diagnostics.push({severity: "error", code: "invalid-prop-value", message: `Prop "${propName}": ${error instanceof Error ? error.message : String(error)}`, path: `${path}.props.${propName}`})
            }
        }
    }

    for (const propName of Object.keys(node.props)) {
        if (propName === "children") {
            diagnostics.push({severity: "warning", code: "children-as-prop-ignored", message: `"children" must be supplied via the node's "children" array, not as a prop value`, path: `${path}.props.children`})
            continue
        }
        if (!(propName in componentMeta.props))
            diagnostics.push({severity: "warning", code: "unknown-prop", message: `Prop "${propName}" is not declared on component "${componentMeta.name}"`, path: `${path}.props.${propName}`})
    }

    const childrenMeta = componentMeta.props["children"]
    const children = node.children ?? []
    if (children.length === 0 && childrenMeta?.required) {
        diagnostics.push({severity: "error", code: "missing-required-prop", message: `Required prop "children" is missing`, path: `${path}.children`})
    }
    if (children.length > 0 && childrenMeta === undefined) {
        diagnostics.push({severity: "warning", code: "unexpected-children", message: `Component "${componentMeta.name}" does not declare a "children" prop`, path: `${path}.children`})
    }
    children.forEach((child, index) => { validateNode(child, `${path}.children[${String(index)}]`, metadata, library, callbacks, diagnostics) })
}

function validateNode(
    node: CompositionNode,
    path: string,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry | undefined,
    diagnostics: CompositionDiagnostic[]
): void {
    if (node.kind === "instance") validateInstance(node, path, metadata, library, callbacks, diagnostics)
    // "text"/"void" are leaves with nothing further to validate.
}

/**
 * Validates a composition document against a `MetadataDocument` (for prop
 * schemas/requiredness) and a `ComponentLibraryData` (for actual component
 * registration). Checks, recursively over the whole tree:
 *
 * - every referenced component `id` exists in both the metadata document and
 *   the registry;
 * - every provided prop value is assignable to that prop's schema
 *   (`fromValueJson`/schema assignability - no hand-rolled validation);
 * - every required prop (including a required `children`) is present;
 * - a `"callback"` prop value is only used on a function-typed prop, and -
 *   only when `callbacks` is supplied - that the named callback actually
 *   exists in the host registry (an editor validating a document before a
 *   host registry exists can omit `callbacks` to skip that specific check).
 *
 * Never throws; returns a structured result. `renderComposition` in
 * render.ts calls this with the real callback registry and throws
 * `CompositionValidationError` if the result is invalid.
 */
export function validateComposition(
    doc: CompositionDocument,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks?: CallbackRegistry
): ValidationResult {
    const diagnostics: CompositionDiagnostic[] = []
    // Widened to `number`: `doc` is typed `CompositionDocument` (schemaVersion narrowed to the
    // literal 1), but a real caller most often has this fresh from `JSON.parse`, so this guards
    // against an on-disk document from a future/foreign schema version at runtime, not just at
    // the type level.
    const schemaVersion: number = doc.schemaVersion
    if (schemaVersion !== 1) {
        diagnostics.push({severity: "error", code: "unsupported-schema-version", message: `Unsupported composition schemaVersion: ${String(schemaVersion)}`, path: "root"})
        return {valid: false, diagnostics}
    }
    validateInstance(doc.root, "root", metadata, library, callbacks, diagnostics)
    return {valid: !diagnostics.some(d => d.severity === "error"), diagnostics}
}
