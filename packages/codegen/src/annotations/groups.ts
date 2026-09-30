import {Node, VariableDeclarationKind} from "ts-morph"
import type {ComponentGroup, Diagnostic, SlotLayer} from "@reactive-forge/schema"

export interface AuthoredGroups {
    componentId: string
    groups: ComponentGroup[]
    layer: SlotLayer
    location?: Diagnostic["location"]
}

export function mergeComponentGroups(entries: AuthoredGroups[]): {groups: ComponentGroup[], diagnostics: Diagnostic[]} {
    let groups: ComponentGroup[] = []
    const diagnostics: Diagnostic[] = []
    for (const layer of ["library", "project"] as const) {
        const declarations = entries.filter(entry => entry.layer === layer)
        const first = declarations[0]
        if (!first) continue
        groups = first.groups
        const canonical = (value: ComponentGroup[]) => JSON.stringify(value.map(group => group.id).sort())
        for (const incoming of declarations.slice(1)) {
            if (canonical(incoming.groups) !== canonical(first.groups)) diagnostics.push({
                severity: "error", code: "component-group-conflict",
                message: `Conflicting component groups declared in the ${layer} layer. The first declaration wins.`,
                location: incoming.location
            })
        }
    }
    return {groups, diagnostics}
}

function literal(node: Node): string | undefined {
    return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralValue() : undefined
}

function validId(id: string): boolean {
    return /^[^\s/]+(?:\/[^\s/]+)+$/.test(id)
}

// Resolve aliases and declarations, never evaluating application code. In particular, a local
// function named defineComponentGroup or constant named RichText is not a Forge definition.
function isForgeDefinition(node: Node, name: string): boolean {
    const symbol = node.getSymbol()
    const resolved = symbol?.getAliasedSymbol() ?? symbol
    if (resolved?.getName() !== name) return false
    return resolved.getDeclarations().some(declaration => {
        const source = declaration.getSourceFile().getFilePath().replace(/\\/g, "/")
        return /\/packages\/schema\/(src|dist)\//.test(source) || source.includes("/node_modules/@reactive-forge/schema/")
    })
}

export function resolveComponentGroup(node: Node, seen = new Set<Node>()): ComponentGroup | undefined {
    if (seen.has(node)) return undefined
    seen.add(node)
    if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node))
        return resolveComponentGroup(node.getExpression(), seen)
    if (Node.isObjectLiteralExpression(node)) {
        const kind = node.getProperty("kind")
        const id = node.getProperty("id")
        if (!kind || !id || !Node.isPropertyAssignment(kind) || !Node.isPropertyAssignment(id)) return undefined
        const kindValue = kind.getInitializer()
        const idValue = id.getInitializer()
        const groupId = idValue ? literal(idValue) : undefined
        if (kindValue && literal(kindValue) === "group" && groupId && validId(groupId)) return {kind: "group", id: groupId}
        return undefined
    }
    if (Node.isCallExpression(node)) {
        if (!isForgeDefinition(node.getExpression(), "defineComponentGroup")) return undefined
        const args = node.getArguments()
        const id = args.length === 1 && args[0] ? literal(args[0]) : undefined
        return id && validId(id) ? {kind: "group", id} : undefined
    }
    if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
        if (isForgeDefinition(node, "Text")) return {kind: "group", id: "forge/Text"}
        if (isForgeDefinition(node, "RichText")) return {kind: "group", id: "forge/RichText"}
        const symbol = node.getSymbol()
        const resolved = symbol?.getAliasedSymbol() ?? symbol
        for (const declaration of resolved?.getDeclarations() ?? []) {
            if (!Node.isVariableDeclaration(declaration) || declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) continue
            const initializer = declaration.getInitializer()
            if (initializer) return resolveComponentGroup(initializer, seen)
        }
    }
    return undefined
}
