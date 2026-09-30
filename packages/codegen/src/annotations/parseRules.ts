// Static ts-morph analysis of `defineComponentMetadata(ComponentRef, {rules: [...]})` call
// expressions - docs/slot-contract.md section 4 (authoring API) and section 5's "Annotation
// source discovery" ("recognizes a *static* defineComponentMetadata(...) call form ... a
// dynamically constructed rules array ... is diagnosed 'unsupported-annotation-expression'").
//
// This module never imports or executes project/fixture source - it only reads AST shape, the
// same discipline `extract.ts`'s `typeToSchema` already follows for component prop types.

import { CallExpression, Node, ObjectLiteralExpression, ts } from "ts-morph"
import { componentId } from "../hash.js"
import { Diagnostic } from "../metadataTypes.js"
import { ComponentIdentity, PathSegment, SlotPath, SlotPolicy, SlotRule, VariantLiteral } from "../slotTypes.js"

function locationOf(node: Node): Diagnostic["location"] {
    const sourceFile = node.getSourceFile()
    const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart())
    return { sourcePath: sourceFile.getFilePath().replace(/\\/g, "/"), line, column }
}

function unsupported(node: Node, detail: string): Diagnostic {
    return {
        severity: "warning",
        code: "unsupported-annotation-expression",
        message: `Unsupported slot-annotation expression (${detail}): ${node.getText()}`,
        location: locationOf(node)
    }
}

// --- literal readers --------------------------------------------------------

function readStringLiteral(node: Node): string | undefined {
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue()
    return undefined
}

function readNumberLiteral(node: Node): number | undefined {
    if (Node.isNumericLiteral(node)) return node.getLiteralValue()
    if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === ts.SyntaxKind.MinusToken) {
        const operand = node.getOperand()
        if (Node.isNumericLiteral(operand)) return -operand.getLiteralValue()
    }
    return undefined
}

function readBooleanLiteral(node: Node): boolean | undefined {
    if (node.getKind() === ts.SyntaxKind.TrueKeyword) return true
    if (node.getKind() === ts.SyntaxKind.FalseKeyword) return false
    return undefined
}

function readVariantLiteral(node: Node): VariantLiteral | undefined {
    return readStringLiteral(node) ?? readNumberLiteral(node) ?? readBooleanLiteral(node)
}

function findProperty(objectLiteral: ObjectLiteralExpression, name: string): Node | undefined {
    const property = objectLiteral.getProperty(name)
    if (property && Node.isPropertyAssignment(property)) return property.getInitializer()
    return undefined
}

// --- component identity (section 5) -----------------------------------------

export interface IdentityResolutionContext {
    rootDir: string
}

// Resolves a `defineComponentMetadata`/`accepts` component reference to a `ComponentIdentity`.
// Two supported static forms:
//  - `externalComponent("pkg", "Export", {subpath?, isDefault?})` - this package's own authoring
//    helper (slotAuthoring.ts) for referencing a third-party export without importing it.
//  - a plain identifier resolving to a value declaration somewhere in the project - the "project"
//    case. Identity is computed the same way `ComponentMetadata.id` already is
//    (`componentId(rootDir, sourcePath, name)`), so it never depends on this module's own guess
//    at whether extraction actually picked the declaration up as a component.
export function resolveComponentIdentity(node: Node, context: IdentityResolutionContext): ComponentIdentity | undefined {
    if (Node.isCallExpression(node)) {
        const calleeText = node.getExpression().getText()
        if (calleeText === "externalComponent" || calleeText.endsWith(".externalComponent")) {
            const args = node.getArguments()
            const pkg = args[0] ? readStringLiteral(args[0]) : undefined
            const exportName = args[1] ? readStringLiteral(args[1]) : undefined
            if (pkg === undefined || exportName === undefined) return undefined
            let subpath: string | undefined
            let isDefault = false
            const optionsArg = args[2]
            if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
                const subpathNode = findProperty(optionsArg, "subpath")
                if (subpathNode) subpath = readStringLiteral(subpathNode)
                const isDefaultNode = findProperty(optionsArg, "isDefault")
                if (isDefaultNode) isDefault = readBooleanLiteral(isDefaultNode) ?? false
            }
            return { source: "external", package: pkg, exportName, isDefault, ...(subpath !== undefined ? { subpath } : {}) }
        }
        return undefined
    }

    if (Node.isIdentifier(node)) {
        return resolveProjectIdentifierIdentity(node, context)
    }

    return undefined
}

function resolveProjectIdentifierIdentity(identifier: Node, context: IdentityResolutionContext): ComponentIdentity | undefined {
    const symbol = identifier.getSymbol()
    if (!symbol) return undefined
    const resolved = symbol.getAliasedSymbol() ?? symbol
    const declarations = resolved.getDeclarations()
    const declaration = declarations[0]
    if (!declaration) return undefined

    const declarationSourceFile = declaration.getSourceFile()
    const sourcePath = declarationSourceFile.getFilePath().replace(/\\/g, "/")

    // Determine the declared local name and whether it is the file's default export.
    let localName: string | undefined
    if (Node.isVariableDeclaration(declaration)) localName = declaration.getName()
    else if (Node.isFunctionDeclaration(declaration)) localName = declaration.getName()
    else localName = resolved.getName()

    if (localName === undefined) return undefined

    const defaultExportSymbol = declarationSourceFile.getDefaultExportSymbol()
    const isDefault = defaultExportSymbol !== undefined &&
        (defaultExportSymbol.getAliasedSymbol() ?? defaultExportSymbol).getDeclarations().includes(declaration)

    const publicName = isDefault ? "default" : localName
    const id = componentId(context.rootDir, sourcePath, publicName)
    return { source: "project", id }
}

// --- path segments (section 2) ----------------------------------------------

function parsePathSegment(node: Node): PathSegment | undefined {
    const literal = readStringLiteral(node)
    if (literal !== undefined) return literal

    if (Node.isCallExpression(node)) {
        const calleeText = node.getExpression().getText()
        if (calleeText === "each") return { kind: "each" }
        if (calleeText === "variant") {
            const args = node.getArguments()
            const propNode = args[0]
            const equalsNode = args[1]
            if (!propNode || !equalsNode) return undefined
            const prop = readStringLiteral(propNode)
            const equals = readVariantLiteral(equalsNode)
            if (prop === undefined || equals === undefined) return undefined
            return { kind: "variant", prop, equals }
        }
    }
    return undefined
}

function parsePath(node: Node, diagnostics: Diagnostic[]): SlotPath | undefined {
    if (!Node.isArrayLiteralExpression(node)) {
        diagnostics.push(unsupported(node, "path is not an array literal"))
        return undefined
    }
    const segments: PathSegment[] = []
    for (const element of node.getElements()) {
        const segment = parsePathSegment(element)
        if (segment === undefined) {
            diagnostics.push(unsupported(element, "unsupported path segment"))
            return undefined
        }
        segments.push(segment)
    }
    return segments
}

// --- slot policy / collection (section 3) -----------------------------------

function parseAccepts(node: Node, context: IdentityResolutionContext, diagnostics: Diagnostic[]): ComponentIdentity[] | undefined {
    if (!Node.isArrayLiteralExpression(node)) {
        diagnostics.push(unsupported(node, "accepts is not an array literal"))
        return undefined
    }
    const identities: ComponentIdentity[] = []
    for (const element of node.getElements()) {
        const identity = resolveComponentIdentity(element, context)
        if (identity === undefined) {
            diagnostics.push(unsupported(element, "unresolvable component reference in accepts"))
            return undefined
        }
        identities.push(identity)
    }
    return identities
}

function parseSlotPolicy(node: Node, context: IdentityResolutionContext, diagnostics: Diagnostic[]): SlotPolicy | undefined {
    if (!Node.isObjectLiteralExpression(node)) {
        diagnostics.push(unsupported(node, "slot policy is not an object literal"))
        return undefined
    }
    const kindNode = findProperty(node, "kind")
    const kind = kindNode ? readStringLiteral(kindNode) : undefined
    if (kind === undefined) {
        diagnostics.push(unsupported(node, "slot policy missing literal 'kind'"))
        return undefined
    }

    const multipleNode = findProperty(node, "multiple")
    const multiple = multipleNode ? readBooleanLiteral(multipleNode) : undefined
    const minItemsNode = findProperty(node, "minItems")
    const minItems = minItemsNode ? readNumberLiteral(minItemsNode) : undefined
    const maxItemsNode = findProperty(node, "maxItems")
    const maxItems = maxItemsNode ? readNumberLiteral(maxItemsNode) : undefined

    if (kind === "any") {
        return {
            kind: "any",
            ...(multiple !== undefined ? { multiple } : {}),
            ...(minItems !== undefined ? { minItems } : {}),
            ...(maxItems !== undefined ? { maxItems } : {})
        }
    }

    if (kind === "components" || kind === "componentRef") {
        const acceptsNode = findProperty(node, "accepts")
        if (!acceptsNode) {
            diagnostics.push(unsupported(node, `${kind} policy missing 'accepts'`))
            return undefined
        }
        const accepts = parseAccepts(acceptsNode, context, diagnostics)
        if (accepts === undefined) return undefined
        if (kind === "componentRef") return { kind: "componentRef", accepts }
        return {
            kind: "components",
            accepts,
            ...(multiple !== undefined ? { multiple } : {}),
            ...(minItems !== undefined ? { minItems } : {}),
            ...(maxItems !== undefined ? { maxItems } : {})
        }
    }

    if (kind === "richText") {
        const inlineNode = findProperty(node, "inline")
        const inline = inlineNode ? readBooleanLiteral(inlineNode) : undefined
        if (inline === undefined) {
            diagnostics.push(unsupported(node, "richText policy missing literal 'inline'"))
            return undefined
        }
        const marksNode = findProperty(node, "marks")
        const marksList: ("bold" | "italic")[] = []
        if (marksNode) {
            if (!Node.isArrayLiteralExpression(marksNode)) {
                diagnostics.push(unsupported(marksNode, "marks is not an array literal"))
                return undefined
            }
            for (const element of marksNode.getElements()) {
                const value = readStringLiteral(element)
                if (value !== "bold" && value !== "italic") {
                    diagnostics.push(unsupported(element, "unknown rich text mark"))
                    return undefined
                }
                marksList.push(value)
            }
        }
        let blocks: { paragraphs?: boolean, lists?: boolean } | undefined
        const blocksNode = findProperty(node, "blocks")
        if (blocksNode) {
            if (!Node.isObjectLiteralExpression(blocksNode)) {
                diagnostics.push(unsupported(blocksNode, "blocks is not an object literal"))
                return undefined
            }
            const paragraphsNode = findProperty(blocksNode, "paragraphs")
            const listsNode = findProperty(blocksNode, "lists")
            blocks = {
                ...(paragraphsNode ? { paragraphs: readBooleanLiteral(paragraphsNode) } : {}),
                ...(listsNode ? { lists: readBooleanLiteral(listsNode) } : {})
            }
        }
        return { kind: "richText", inline, marks: marksList, ...(blocks !== undefined ? { blocks } : {}) }
    }

    diagnostics.push(unsupported(node, `unknown slot policy kind "${kind}"`))
    return undefined
}

function parseCollection(node: Node, diagnostics: Diagnostic[]): { minItems?: number, maxItems?: number } | undefined {
    if (!Node.isObjectLiteralExpression(node)) {
        diagnostics.push(unsupported(node, "collection is not an object literal"))
        return undefined
    }
    const minItemsNode = findProperty(node, "minItems")
    const maxItemsNode = findProperty(node, "maxItems")
    const minItems = minItemsNode ? readNumberLiteral(minItemsNode) : undefined
    const maxItems = maxItemsNode ? readNumberLiteral(maxItemsNode) : undefined
    if ((minItemsNode && minItems === undefined) || (maxItemsNode && maxItems === undefined)) {
        diagnostics.push(unsupported(node, "collection bound is not a literal number"))
        return undefined
    }
    return { ...(minItems !== undefined ? { minItems } : {}), ...(maxItems !== undefined ? { maxItems } : {}) }
}

// --- top-level: one SlotRule object literal ---------------------------------

function parseEditor(node: Node, diagnostics: Diagnostic[]): SlotRule["editor"] {
    if (!Node.isObjectLiteralExpression(node)) {
        diagnostics.push(unsupported(node, "editor is not an object literal"))
        return undefined
    }
    const editor: NonNullable<SlotRule["editor"]> = {}
    const seen = new Set<string>()
    for (const property of node.getProperties()) {
        if (!Node.isPropertyAssignment(property) || Node.isComputedPropertyName(property.getNameNode())) {
            diagnostics.push(unsupported(property, "editor fields must be static property assignments"))
            return undefined
        }
        const nameNode = property.getNameNode()
        const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : property.getName()
        if (!["visibility", "group", "label"].includes(key) || seen.has(key)) {
            diagnostics.push(unsupported(property, "unknown or duplicate editor field"))
            return undefined
        }
        seen.add(key)
        const initializer = property.getInitializer()
        const value = initializer ? readStringLiteral(initializer) : undefined
        if (value === undefined) {
            diagnostics.push(unsupported(property, "editor fields must be literal strings"))
            return undefined
        }
        if (key === "visibility") {
            if (value !== "primary" && value !== "advanced" && value !== "hidden" && value !== "auto") {
                diagnostics.push(unsupported(property, "unknown editor visibility"))
                return undefined
            }
            editor.visibility = value
        } else if (key === "group") editor.group = value
        else editor.label = value
    }
    return editor
}

function parseSlotRule(node: Node, context: IdentityResolutionContext, diagnostics: Diagnostic[]): SlotRule | undefined {
    if (!Node.isObjectLiteralExpression(node)) {
        diagnostics.push(unsupported(node, "rule is not an object literal"))
        return undefined
    }
    const pathNode = findProperty(node, "path")
    if (!pathNode) {
        diagnostics.push(unsupported(node, "rule missing 'path'"))
        return undefined
    }
    const path = parsePath(pathNode, diagnostics)
    if (path === undefined) return undefined

    let collection: SlotRule["collection"]
    const collectionNode = findProperty(node, "collection")
    if (collectionNode) {
        collection = parseCollection(collectionNode, diagnostics)
        if (collection === undefined) return undefined
    }

    let slot: SlotPolicy | undefined
    const slotNode = findProperty(node, "slot")
    if (slotNode) {
        slot = parseSlotPolicy(slotNode, context, diagnostics)
        if (slot === undefined) return undefined
    }

    let editor: SlotRule["editor"]
    const editorProperty = node.getProperty("editor")
    if (editorProperty) {
        const editorNode = findProperty(node, "editor")
        if (!editorNode) {
            diagnostics.push(unsupported(editorProperty, "editor must be a static object literal"))
            return undefined
        }
        if (path.length === 0) {
            diagnostics.push(unsupported(editorNode, "editor paths must target a prop, not the component root"))
            return undefined
        }
        editor = parseEditor(editorNode, diagnostics)
        if (editor === undefined) return undefined
    }

    return { path, ...(collection !== undefined ? { collection } : {}), ...(slot !== undefined ? { slot } : {}),
        ...(editor !== undefined ? { editor } : {}) }
}

export interface ParsedDefineComponentMetadataCall {
    componentRefNode: Node
    identity: ComponentIdentity | undefined
    rules: SlotRule[]
    diagnostics: Diagnostic[]
    location: Diagnostic["location"]
}

// Parses one `defineComponentMetadata(ComponentRef, {rules: [...]})` call, exactly the static
// form section 5 requires ("a direct call expression"). Anything else about the surrounding
// declaration (const binding, export form) is the caller's job (colocated.ts / external.ts).
export function parseDefineComponentMetadataCall(call: CallExpression, context: IdentityResolutionContext): ParsedDefineComponentMetadataCall | undefined {
    const calleeText = call.getExpression().getText()
    if (calleeText !== "defineComponentMetadata" && !calleeText.endsWith(".defineComponentMetadata")) return undefined

    const args = call.getArguments()
    const componentRefNode = args[0]
    const configNode = args[1]
    if (!componentRefNode) return undefined

    const diagnostics: Diagnostic[] = []
    const identity = resolveComponentIdentity(componentRefNode, context)

    let rules: SlotRule[] = []
    if (configNode) {
        if (!Node.isObjectLiteralExpression(configNode)) {
            diagnostics.push(unsupported(configNode, "defineComponentMetadata config is not an object literal"))
        } else {
            const rulesNode = findProperty(configNode, "rules")
            if (rulesNode) {
                if (!Node.isArrayLiteralExpression(rulesNode)) {
                    diagnostics.push(unsupported(rulesNode, "rules is not an array literal"))
                } else {
                    const parsedRules: SlotRule[] = []
                    let ok = true
                    for (const element of rulesNode.getElements()) {
                        const parsed = parseSlotRule(element, context, diagnostics)
                        if (parsed === undefined) { ok = false; continue }
                        parsedRules.push(parsed)
                    }
                    // Per section 5: a dynamically-constructed rules array (here: any element that
                    // failed static parsing) is diagnosed and the *whole call* is ignored for slot
                    // purposes, never partially evaluated.
                    rules = ok ? parsedRules : []
                }
            }
        }
    }

    return { componentRefNode, identity, rules, diagnostics, location: locationOf(call) }
}

// Finds every `defineComponentMetadata(...)` call expression anywhere under `root` (a source
// file or an array-literal `components: [...]` list inside a `defineLibraryMetadata` call) -
// used by both colocated.ts (scans whole source files) and external.ts (scans one resolved
// `components` array).
export function findDefineComponentMetadataCalls(root: Node): CallExpression[] {
    const calls: CallExpression[] = []
    root.forEachDescendant(node => {
        if (Node.isCallExpression(node)) {
            const calleeText = node.getExpression().getText()
            if (calleeText === "defineComponentMetadata" || calleeText.endsWith(".defineComponentMetadata")) calls.push(node)
        }
    })
    return calls
}

export { locationOf, unsupported }
