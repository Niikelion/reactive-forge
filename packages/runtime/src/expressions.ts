import {ArraySchema, BooleanSchema, FunctionEntry, NumberSchema, ObjectSchema, Schema, schemaFromJson, StringSchema, UnionSchema, ValueAdapterRegistry, ValueJson} from "@reactive-forge/schema"
import {assignable} from "./props.js"
import type {CompositionBinaryOp, CompositionExpression, CompositionLocal, CompositionPropDeclaration} from "./composition.js"
import {decodeAdapterValue} from "./adapters.js"

// Expressions: docs/composition-expressions.md. Typing, evaluation and TypeScript emission live
// together so the three can never disagree about what an expression means.

export const BINARY_OPS: readonly CompositionBinaryOp[] = ["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "&&", "||"]
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"])

export class ExpressionError extends Error {
    constructor(readonly code: string, message: string) {
        super(message)
        this.name = "ExpressionError"
    }
}

// ---------------------------------------------------------------------------------------------
// Locals: dependency order and cycles.
// ---------------------------------------------------------------------------------------------

function visit(expression: CompositionExpression, each: (expression: CompositionExpression) => void): void {
    each(expression)
    switch (expression.kind) {
        case "get": visit(expression.object, each); return
        case "object": for (const field of Object.values(expression.fields)) visit(field, each); return
        case "if": visit(expression.condition, each); visit(expression.then, each); visit(expression.else, each); return
        case "match":
            visit(expression.input, each)
            for (const branch of Object.values(expression.cases)) visit(branch, each)
            if (expression.fallback) visit(expression.fallback, each)
            return
        case "binary": visit(expression.left, each); visit(expression.right, each); return
        case "unary": visit(expression.value, each); return
        case "call": for (const arg of expression.args) visit(arg, each); return
        default: return
    }
}

/** The names of the functions an expression calls. */
export function calledFunctions(expression: CompositionExpression): string[] {
    const names = new Set<string>()
    visit(expression, current => { if (current.kind === "call") names.add(current.function) })
    return [...names]
}

/** Locals in an order where each comes after the locals it uses. Throws on an unknown local or a cycle. */
export function orderLocals(locals: Record<string, CompositionLocal>): string[] {
    const order: string[] = []
    const state = new Map<string, "visiting" | "done">()
    function enter(name: string, trail: string[]): void {
        if (state.get(name) === "done") return
        if (state.get(name) === "visiting") throw new ExpressionError("local-cycle", `Locals refer to each other in a cycle: ${[...trail, name].join(" -> ")}`)
        const local = Object.hasOwn(locals, name) ? locals[name] : undefined
        if (!local) throw new ExpressionError("unknown-local", `Unknown local "${name}"`)
        state.set(name, "visiting")
        visit(local.expression, current => { if (current.kind === "local") enter(current.name, [...trail, name]) })
        state.set(name, "done")
        order.push(name)
    }
    for (const name of Object.keys(locals)) enter(name, [])
    return order
}

// ---------------------------------------------------------------------------------------------
// Typing.
// ---------------------------------------------------------------------------------------------

export interface TypeScope {
    prop(name: string): CompositionPropDeclaration | undefined
    local(name: string): Schema | undefined
    function(name: string): FunctionEntry | undefined
}

const undefinedSchema = (): Schema => schemaFromJson({type: "undefined"})
const nullSchema = (): Schema => schemaFromJson({type: "null"})
const json = (schema: Schema): string => JSON.stringify(schema.toJson())

function members(schema: Schema): Schema[] {
    return schema instanceof UnionSchema ? schema.types.flatMap(members) : [schema]
}

/** A union of the given types, flattened and without duplicates. */
export function unionOf(schemas: Schema[]): Schema {
    const unique = new Map<string, Schema>()
    for (const member of schemas.flatMap(members)) unique.set(json(member), member)
    const all = [...unique.values()]
    if (all.length === 1 && all[0]) return all[0]
    return new UnionSchema(all)
}

const isNullish = (schema: Schema): boolean => schema.name === "undefined" || schema.name === "null" || schema.name === "void"
const every = (schema: Schema, test: (member: Schema) => boolean): boolean => members(schema).every(test)
const isNumber = (schema: Schema): boolean => every(schema, member => member instanceof NumberSchema)
const isString = (schema: Schema): boolean => every(schema, member => member instanceof StringSchema)
/** A condition: boolean, or a value that may be missing (which counts as false). */
const isCondition = (schema: Schema): boolean => every(schema, member => member instanceof BooleanSchema || isNullish(member)) && members(schema).some(member => member instanceof BooleanSchema)

/** The type a declared prop has where it is read: a default removes undefined, as for a binding. */
export function declaredPropSchema(declaration: CompositionPropDeclaration): Schema {
    const schema = schemaFromJson(declaration.schema)
    const defaulted = declaration.defaultValue !== undefined && declaration.defaultValue.type !== "undefined" && declaration.defaultValue.type !== "void"
    if (!defaulted && !declaration.required) return unionOf([schema, undefinedSchema()])
    if (!defaulted) return schema
    const present = members(schema).filter(member => member.name !== "undefined" && member.name !== "void")
    return present.length ? unionOf(present) : schema
}

function literalSchema(value: ValueJson): Schema {
    switch (value.type) {
        case "string": return new StringSchema(value.value)
        case "number": return new NumberSchema(value.value)
        case "boolean": return new BooleanSchema(value.value)
        case "null": return nullSchema()
        case "undefined": return undefinedSchema()
        case "object": return new ObjectSchema(Object.fromEntries(Object.entries(value.value).map(([key, field]) => [key, {schema: literalSchema(field), required: true}])))
        case "array": return new ArraySchema(value.value.map(literalSchema))
        default: throw new ExpressionError("invalid-expression", `A literal of type "${value.type}" cannot be used in an expression`)
    }
}

/** The finite set of literal values a type allows, or undefined when it is not finite. */
function literalValues(schema: Schema): (string | number | boolean)[] | undefined {
    const values: (string | number | boolean)[] = []
    for (const member of members(schema)) {
        if (isNullish(member)) continue
        if (member instanceof BooleanSchema) {
            if (member.literal === undefined) values.push(true, false)
            else values.push(member.literal)
            continue
        }
        if ((member instanceof StringSchema || member instanceof NumberSchema) && member.literal !== undefined) {
            values.push(member.literal)
            continue
        }
        return undefined
    }
    return values
}

/** The type an expression produces. Throws ExpressionError when it is not well typed. */
export function expressionSchema(expression: CompositionExpression, scope: TypeScope): Schema {
    const of = (child: CompositionExpression): Schema => expressionSchema(child, scope)
    switch (expression.kind) {
        case "literal": return literalSchema(expression.value)
        case "prop": {
            const declaration = scope.prop(expression.name)
            if (!declaration) throw new ExpressionError("undeclared-composition-prop", `Expression references undeclared composition prop "${expression.name}"`)
            return declaredPropSchema(declaration)
        }
        case "local": {
            const schema = scope.local(expression.name)
            if (!schema) throw new ExpressionError("unknown-local", `Unknown local "${expression.name}"`)
            return schema
        }
        case "get": {
            if (forbiddenKeys.has(expression.key)) throw new ExpressionError("invalid-expression", `Property "${expression.key}" cannot be read`)
            const object = of(expression.object)
            const objects = members(object).filter(member => !isNullish(member))
            if (!objects.length || !objects.every(member => member instanceof ObjectSchema))
                throw new ExpressionError("invalid-expression", `Property "${expression.key}" is read from a value that is not an object`)
            const fields = objects.map(member => {
                const objectSchema = member as ObjectSchema
                const field = objectSchema.properties[expression.key]
                if (field) return field.required ? field.schema : unionOf([field.schema, undefinedSchema()])
                if (objectSchema.indexType) return unionOf([objectSchema.indexType, undefinedSchema()])
                throw new ExpressionError("invalid-expression", `Unknown property "${expression.key}"`)
            })
            return unionOf(objects.length < members(object).length ? [...fields, undefinedSchema()] : fields)
        }
        case "object":
            return new ObjectSchema(Object.fromEntries(Object.entries(expression.fields).map(([key, field]) => {
                if (forbiddenKeys.has(key)) throw new ExpressionError("invalid-expression", `Field "${key}" cannot be written`)
                return [key, {schema: of(field), required: true}]
            })))
        case "if": {
            if (!isCondition(of(expression.condition))) throw new ExpressionError("invalid-expression", "A condition must be a boolean")
            return unionOf([of(expression.then), of(expression.else)])
        }
        case "match": {
            const input = of(expression.input)
            const keys = Object.keys(expression.cases)
            if (!keys.length) throw new ExpressionError("invalid-expression", "A match needs at least one case")
            if (!expression.fallback) {
                const values = literalValues(input)
                if (!values) throw new ExpressionError("non-exhaustive-match", "A match over a value that is not a fixed set of literals needs a fallback")
                const missing = values.map(String).filter(value => !keys.includes(value))
                if (missing.length) throw new ExpressionError("non-exhaustive-match", `A match has no case for ${missing.map(value => JSON.stringify(value)).join(", ")} and no fallback`)
                if (members(input).some(isNullish)) throw new ExpressionError("non-exhaustive-match", "A match over a value that may be missing needs a fallback")
            }
            return unionOf([...Object.values(expression.cases).map(of), ...(expression.fallback ? [of(expression.fallback)] : [])])
        }
        case "binary": {
            if (!BINARY_OPS.includes(expression.op)) throw new ExpressionError("invalid-expression", `Unknown operator "${String(expression.op)}"`)
            const left = of(expression.left), right = of(expression.right)
            switch (expression.op) {
                case "+":
                    if (isNumber(left) && isNumber(right)) return new NumberSchema()
                    if ((isString(left) || isNumber(left)) && (isString(right) || isNumber(right))) return new StringSchema()
                    throw new ExpressionError("invalid-expression", "+ adds numbers or joins strings")
                case "-": case "*": case "/": case "%":
                    if (isNumber(left) && isNumber(right)) return new NumberSchema()
                    throw new ExpressionError("invalid-expression", `${expression.op} needs numbers on both sides`)
                case "==": case "!=":
                    return new BooleanSchema()
                case "<": case "<=": case ">": case ">=":
                    if ((isNumber(left) && isNumber(right)) || (isString(left) && isString(right))) return new BooleanSchema()
                    throw new ExpressionError("invalid-expression", `${expression.op} compares two numbers or two strings`)
                case "&&": case "||":
                    if (isCondition(left) && isCondition(right)) return new BooleanSchema()
                    throw new ExpressionError("invalid-expression", `${expression.op} needs booleans on both sides`)
            }
            throw new ExpressionError("invalid-expression", "Unknown operator")
        }
        case "unary": {
            const value = of(expression.value)
            if (expression.op === "!") {
                if (!isCondition(value)) throw new ExpressionError("invalid-expression", "! needs a boolean")
                return new BooleanSchema()
            }
            if (expression.op === "-") {
                if (!isNumber(value)) throw new ExpressionError("invalid-expression", "Unary - needs a number")
                return new NumberSchema()
            }
            throw new ExpressionError("invalid-expression", `Unknown operator "${String(expression.op)}"`)
        }
        case "call": {
            const entry = Object.hasOwn(expression, "function") ? scope.function(expression.function) : undefined
            if (!entry) throw new ExpressionError("unknown-function", `Unknown function "${expression.function}"; the host registers functions in library.functions`)
            if (expression.args.length < entry.params.length) throw new ExpressionError("invalid-expression", `"${expression.function}" takes ${String(entry.params.length)} arguments`)
            if (expression.args.length > entry.params.length && !entry.rest) throw new ExpressionError("invalid-expression", `"${expression.function}" takes ${String(entry.params.length)} arguments`)
            expression.args.forEach((arg, index) => {
                const parameter = schemaFromJson(index < entry.params.length ? entry.params[index] as typeof entry.returns : entry.rest as typeof entry.returns)
                if (!assignable(of(arg), parameter)) throw new ExpressionError("incompatible-expression", `Argument ${String(index + 1)} of "${expression.function}" does not fit its parameter`)
            })
            return schemaFromJson(entry.returns)
        }
    }
    throw new ExpressionError("invalid-expression", `Unknown expression kind "${String((expression as {kind: unknown}).kind)}"`)
}

// ---------------------------------------------------------------------------------------------
// Evaluation.
// ---------------------------------------------------------------------------------------------

export interface EvaluationScope {
    props: Record<string, unknown>
    locals: Record<string, unknown>
    functions?: Record<string, FunctionEntry>
}

/** Evaluates a validated expression. Pure: the same scope always gives the same value. */
export function evaluateExpression(expression: CompositionExpression, scope: EvaluationScope, adapters?: ValueAdapterRegistry): unknown {
    const of = (child: CompositionExpression): unknown => evaluateExpression(child, scope, adapters)
    switch (expression.kind) {
        case "literal": return decodeAdapterValue(expression.value, adapters)
        case "prop": return scope.props[expression.name]
        case "local": return scope.locals[expression.name]
        case "get": {
            const object = of(expression.object)
            if (object === null || typeof object !== "object" || !Object.hasOwn(object, expression.key)) return undefined
            return (object as Record<string, unknown>)[expression.key]
        }
        case "object": return Object.fromEntries(Object.entries(expression.fields).map(([key, field]) => [key, of(field)]))
        case "if": return of(expression.condition) === true ? of(expression.then) : of(expression.else)
        case "match": {
            const key = String(of(expression.input))
            if (Object.hasOwn(expression.cases, key)) return of(expression.cases[key] as CompositionExpression)
            return expression.fallback ? of(expression.fallback) : undefined
        }
        case "binary": {
            if (expression.op === "&&") return of(expression.left) === true && of(expression.right) === true
            if (expression.op === "||") return of(expression.left) === true || of(expression.right) === true
            const left = of(expression.left) as number & string, right = of(expression.right) as number & string
            switch (expression.op) {
                case "+": return left + right
                case "-": return left - right
                case "*": return left * right
                case "/": return left / right
                case "%": return left % right
                case "==": return left === right
                case "!=": return left !== right
                case "<": return left < right
                case "<=": return left <= right
                case ">": return left > right
                case ">=": return left >= right
            }
            return undefined
        }
        case "unary": return expression.op === "!" ? of(expression.value) !== true : -(of(expression.value) as number)
        case "call": {
            const entry = scope.functions?.[expression.function]
            if (!entry) throw new Error(`renderComposition: function "${expression.function}" is not registered (should have been caught by validateComposition)`)
            return (entry.implementation as (...args: unknown[]) => unknown)(...expression.args.map(of))
        }
    }
}

/** Every local's value, each computed once, in dependency order. */
export function evaluateLocals(locals: Record<string, CompositionLocal> | undefined, props: Record<string, unknown>, functions: Record<string, FunctionEntry> | undefined, adapters?: ValueAdapterRegistry): Record<string, unknown> {
    const scope: EvaluationScope = {props, locals: {}, functions}
    if (!locals) return scope.locals
    for (const name of orderLocals(locals)) scope.locals[name] = evaluateExpression((locals[name] as CompositionLocal).expression, scope, adapters)
    return scope.locals
}

// ---------------------------------------------------------------------------------------------
// TypeScript emission.
// ---------------------------------------------------------------------------------------------

export interface EmitScope {
    types: TypeScope
    /** Source text reading a public prop (defaults already applied). */
    prop(name: string): string
    /** The const a local is written to. */
    local(name: string): string
    literal(value: ValueJson): string
    /** The local name a registered function is imported as. */
    function(name: string): string
}

// Precedence, higher binds tighter. Only the relative order matters.
const PRIMARY = 20, UNARY = 15, MULTIPLY = 13, ADD = 12, RELATIONAL = 10, EQUALITY = 9, AND = 5, OR = 4, NULLISH = 3.5, CONDITIONAL = 3
const binaryPrecedence: Record<CompositionBinaryOp, number> = {
    "*": MULTIPLY, "/": MULTIPLY, "%": MULTIPLY, "+": ADD, "-": ADD,
    "<": RELATIONAL, "<=": RELATIONAL, ">": RELATIONAL, ">=": RELATIONAL,
    "==": EQUALITY, "!=": EQUALITY, "&&": AND, "||": OR,
}
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const propertyKey = (key: string): string => identifier.test(key) ? key : JSON.stringify(key)

interface Emitted {text: string, precedence: number}

function wrap(emitted: Emitted, minimum: number): string {
    return emitted.precedence < minimum ? `(${emitted.text})` : emitted.text
}

/** The literal a match case key stands for, given what the input can be. */
function caseLiteral(key: string, input: Schema): string {
    const kinds = members(input).filter(member => !isNullish(member))
    if (kinds.every(member => member instanceof BooleanSchema) && (key === "true" || key === "false")) return key
    if (kinds.every(member => member instanceof NumberSchema) && key.trim() !== "" && !Number.isNaN(Number(key))) return String(Number(key))
    return JSON.stringify(key)
}

function emit(expression: CompositionExpression, scope: EmitScope): Emitted {
    const of = (child: CompositionExpression): Emitted => emit(child, scope)
    switch (expression.kind) {
        case "literal": {
            const text = scope.literal(expression.value)
            return {text, precedence: text.startsWith("-") ? UNARY : PRIMARY}
        }
        case "prop": return {text: scope.prop(expression.name), precedence: PRIMARY}
        case "local": return {text: scope.local(expression.name), precedence: PRIMARY}
        case "get": {
            const object = wrap(of(expression.object), PRIMARY)
            const optional = members(expressionSchema(expression.object, scope.types)).some(isNullish)
            const access = identifier.test(expression.key) ? `${optional ? "?." : "."}${expression.key}` : `${optional ? "?." : ""}[${JSON.stringify(expression.key)}]`
            return {text: object + access, precedence: PRIMARY}
        }
        case "object":
            return {text: `{${Object.entries(expression.fields).map(([key, field]) => `${propertyKey(key)}: ${of(field).text}`).join(", ")}}`, precedence: PRIMARY}
        case "if":
            return {text: `${wrap(of(expression.condition), OR)} ? ${wrap(of(expression.then), CONDITIONAL)} : ${wrap(of(expression.else), CONDITIONAL)}`, precedence: CONDITIONAL}
        case "match": {
            const input = of(expression.input)
            const inputType = expressionSchema(expression.input, scope.types)
            const cases = Object.entries(expression.cases)
            if (cases.length <= 3) {
                // A chain of conditionals; the fallback, or the last case, is the final branch.
                const tested = expression.fallback ? cases : cases.slice(0, -1)
                let text = expression.fallback ? wrap(of(expression.fallback), CONDITIONAL) : wrap(of((cases.at(-1) as [string, CompositionExpression])[1]), CONDITIONAL)
                for (const [key, branch] of [...tested].reverse())
                    text = `${wrap(input, EQUALITY + 1)} === ${caseLiteral(key, inputType)} ? ${wrap(of(branch), CONDITIONAL)} : ${text}`
                return {text, precedence: tested.length ? CONDITIONAL : PRIMARY}
            }
            const table = `({${cases.map(([key, branch]) => `${JSON.stringify(key)}: ${of(branch).text}`).join(", ")}})[${input.text}]`
            return expression.fallback ? {text: `${table} ?? ${wrap(of(expression.fallback), NULLISH + 0.1)}`, precedence: NULLISH} : {text: table, precedence: PRIMARY}
        }
        case "binary": {
            const precedence = binaryPrecedence[expression.op]
            const op = expression.op === "==" ? "===" : expression.op === "!=" ? "!==" : expression.op
            return {text: `${wrap(of(expression.left), precedence)} ${op} ${wrap(of(expression.right), precedence + 0.1)}`, precedence}
        }
        case "unary": {
            const operand = wrap(of(expression.value), UNARY)
            const text = expression.op === "-" && operand.startsWith("-") ? `-(${operand})` : `${expression.op}${operand}`
            return {text, precedence: UNARY}
        }
        case "call":
            return {text: `${scope.function(expression.function)}(${expression.args.map(arg => of(arg).text).join(", ")})`, precedence: PRIMARY}
    }
}

/** An expression as TypeScript source. */
export function emitExpression(expression: CompositionExpression, scope: EmitScope): string {
    return emit(expression, scope).text
}
