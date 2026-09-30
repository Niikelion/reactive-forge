import {cloneElement, createElement, Fragment, isValidElement, ReactElement, ReactNode, useEffect, useRef, useState} from "react"
import {ComponentLibraryData, ComponentMetadata, MetadataDocument, resolveSlotPolicy, RichTextMark, RichTextTextNode, RichTextValueJson} from "@reactive-forge/schema"
import {CallbackRegistry, CompositionDocument, CompositionInstance, CompositionSlotItem, CompositionValue, renderComposition} from "@reactive-forge/runtime"
import {updateInstanceAtPath, ValuePath} from "./preview.js"
import {editValue, generateId, insertAtValuePath, moveAtValuePath, newTextItem, removeAtValuePath, SlotOperationResult, toggleRichTextMark} from "./slots.js"

export const componentDragType = "application/x-reactive-forge-component"

export interface SlotOutletContext {
    path: ValuePath
    value: CompositionValue
    children: ReactNode
    /** The default flow-content outlet. Use an adapter in tables or components that inspect children. */
    outlet: ReactElement
}

export interface CompositionEditorProps {
    document: CompositionDocument
    metadata: MetadataDocument
    library: ComponentLibraryData
    onChange: (document: CompositionDocument) => void
    callbacks?: CallbackRegistry
    /** Return a fully initialized instance for components with required props. */
    createInstance?: (component: ComponentMetadata) => CompositionInstance | undefined
    /** Override outlet placement/markup for components with special child or layout semantics. */
    renderSlot?: (context: SlotOutletContext) => ReactNode
}

/** Sources carry registry IDs only; drops never deserialize executable content. */
export function ComponentPalette({metadata}: {metadata: MetadataDocument}): ReactElement {
    return createElement("div", {"aria-label": "Component palette"}, metadata.components.map(component =>
        createElement("button", {
            key: component.id, type: "button", draggable: true,
            "data-component-id": component.id,
            onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
            },
            onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                event.currentTarget.releasePointerCapture(event.pointerId)
                const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drop-index]")
                target?.dispatchEvent(new CustomEvent("forge-component-drop", {bubbles: true, detail: component.id}))
            },
            onDragStart: (event: React.DragEvent) => {
                event.dataTransfer.setData(componentDragType, component.id)
                event.dataTransfer.effectAllowed = "copy"
            }
        }, component.name)))
}

/** Parse a closed rich-text vocabulary. Attributes and unknown elements are rejected, never retained. */
export function readRichTextDom(root: HTMLElement, inline: boolean): RichTextValueJson {
    function runs(nodes: NodeListOf<ChildNode>, marks: RichTextMark[] = []): RichTextTextNode[] {
        return Array.from(nodes).flatMap(node => {
            if (node.nodeType === 3) return [{type: "text" as const, text: node.textContent ?? "", marks}]
            if (node.nodeType !== 1) throw new Error("Unsupported pasted content")
            const element = node as HTMLElement
            if (element.attributes.length > 0) throw new Error("Rich text does not allow attributes")
            const tag = element.tagName.toLowerCase()
            if (tag === "br") return [{type: "text" as const, text: "\n", marks}]
            if (!["span", "b", "strong", "i", "em"].includes(tag)) throw new Error(`Rich text does not allow ${tag}`)
            const mark = tag === "b" || tag === "strong" ? "bold" : tag === "i" || tag === "em" ? "italic" : undefined
            return runs(element.childNodes, mark === undefined || marks.includes(mark) ? marks : [...marks, mark])
        })
    }
    if (inline) return {kind: "richText", version: 1, inline: true, nodes: runs(root.childNodes)}
    const nodes: Extract<RichTextValueJson, {inline: false}>["nodes"] = []
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType === 3) {
            if (node.textContent) nodes.push({type: "paragraph", children: [{type: "text", text: node.textContent, marks: []}]})
            continue
        }
        if (node.nodeType !== 1) throw new Error("Unsupported pasted content")
        const element = node as HTMLElement
        if (element.attributes.length > 0) throw new Error("Rich text does not allow attributes")
        const tag = element.tagName.toLowerCase()
        if (tag === "p" || tag === "div") nodes.push({type: "paragraph", children: runs(element.childNodes)})
        else if (tag === "ul" || tag === "ol") {
            const items = Array.from(element.children).map(item => {
                if (item.tagName !== "LI" || item.attributes.length > 0) throw new Error("Lists may only contain plain list items")
                return {type: "listItem" as const, children: runs(item.childNodes)}
            })
            nodes.push({type: tag === "ul" ? "bulletList" : "orderedList", items})
        } else throw new Error(`Rich text does not allow ${tag}`)
    }
    return {kind: "richText", version: 1, inline: false, nodes}
}

interface OutletProps extends CompositionEditorProps {
    path: ValuePath
    value: Extract<CompositionValue, {kind: "nodes" | "richText"}>
    children: ReactNode
}

function EditableOutlet(props: OutletProps): ReactElement {
    const {document, metadata, library, path, value, callbacks, onChange} = props
    const [message, setMessage] = useState("")
    const [selected, setSelected] = useState("")
    const [text, setText] = useState("")
    const [revision, setRevision] = useState(0)
    const outletRef = useRef<HTMLSpanElement>(null)
    const commit = (result: SlotOperationResult) => {
        setMessage(result.ok ? "" : result.reason)
        if (result.ok) onChange(result.document)
        return result.ok
    }
    const candidate = (id: string): CompositionSlotItem | undefined => {
        const component = metadata.components.find(c => c.id === id)
        if (!component) return undefined
        const instance = props.createInstance ? props.createInstance(component) : {kind: "instance" as const, instanceId: generateId("instance"), componentId: id, props: {}}
        return instance ? {kind: "instance", itemId: generateId("item"), instance} : undefined
    }
    const insert = (id: string, index: number) => {
        const item = candidate(id)
        if (!item) { setMessage("Initialize the component's required props before inserting it."); return }
        commit(insertAtValuePath(document, metadata, library, path, index, item, callbacks))
    }
    useEffect(() => {
        const element = outletRef.current
        if (!element) return
        const drop = (event: Event) => {
            if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return
            const target = event.target as HTMLElement
            if (target.closest("[data-slot-path]") !== element) return
            event.stopPropagation()
            insert(event.detail, Number(target.dataset["dropIndex"]))
        }
        element.addEventListener("forge-component-drop", drop)
        return () => { element.removeEventListener("forge-component-drop", drop) }
    })
    const dropPoint = (index: number) => createElement("span", {
        key: `drop-${String(index)}`, tabIndex: 0, role: "button", "aria-label": `Drop component at ${String(index + 1)}`,
        "data-drop-index": index, style: {display: "inline-block", minWidth: "1rem", border: "1px dashed #73839b", padding: "0 .2rem"},
        onDragOver: (event: React.DragEvent) => { if (event.dataTransfer.types.includes(componentDragType)) event.preventDefault() },
        onDrop: (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); insert(event.dataTransfer.getData(componentDragType), index) },
        onClick: () => { if (selected) insert(selected, index) },
        onKeyDown: (event: React.KeyboardEvent) => { if ((event.key === "Enter" || event.key === " ") && selected) { event.preventDefault(); insert(selected, index) } }
    }, "+")
    const error = message ? createElement("span", {role: "alert"}, message) : null
    if (value.kind === "richText") {
        const save = (element: HTMLElement) => {
            try { commit(editValue(document, metadata, library, path, () => ({kind: "richText", value: readRichTextDom(element, value.value.inline)}), callbacks)) }
            catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
            setRevision(r => r + 1)
        }
        return createElement("span", {"data-slot-path": JSON.stringify(path), style: {display: "contents"}},
            createElement(value.value.inline ? "span" : "div", {
                key: revision, contentEditable: true, suppressContentEditableWarning: true, role: "textbox", "aria-label": "Edit rich text",
                onBlur: (event: React.FocusEvent<HTMLElement>) => { save(event.currentTarget) },
                onPaste: (event: React.ClipboardEvent<HTMLElement>) => {
                    event.preventDefault()
                    try {
                        const html = event.clipboardData.getData("text/html")
                        const root = event.currentTarget.ownerDocument.createElement("div")
                        if (html) root.innerHTML = html
                        else if (value.value.inline) root.textContent = event.clipboardData.getData("text/plain")
                        else { const p = root.ownerDocument.createElement("p"); p.textContent = event.clipboardData.getData("text/plain"); root.append(p) }
                        const next = readRichTextDom(root, value.value.inline)
                        commit(editValue(document, metadata, library, path, () => ({kind: "richText", value: next}), callbacks))
                    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
                    setRevision(r => r + 1)
                }
            }, props.children),
            ...(["bold", "italic"] as const).map(mark => createElement("button", {
                key: mark, type: "button", "aria-label": `Toggle ${mark}`,
                onMouseDown: (event: React.MouseEvent) => { event.preventDefault() },
                onClick: () => { commit(editValue(document, metadata, library, path, () => ({kind: "richText", value: toggleRichTextMark(value.value, mark)}), callbacks)) }
            }, mark)), error)
    }
    const rendered: ReactNode[] = Array.isArray(props.children) ? props.children as ReactNode[] : [props.children]
    const children: ReactNode[] = [dropPoint(0)]
    value.value.items.forEach((item, index) => {
        children.push(createElement(Fragment, {key: item.itemId}, rendered[index],
            createElement("button", {type: "button", "aria-label": "Remove slot item", onClick: () => { commit(removeAtValuePath(document, metadata, library, path, item.itemId, callbacks)) }}, "×"),
            createElement("button", {type: "button", "aria-label": "Move slot item up", disabled: index === 0, onClick: () => { commit(moveAtValuePath(document, metadata, library, path, index, index - 1, callbacks)) }}, "↑")))
        children.push(dropPoint(index + 1))
    })
    const palette = metadata.components.map(component => {
        const item = candidate(component.id)
        const result = item ? insertAtValuePath(document, metadata, library, path, value.value.items.length, item, callbacks) : undefined
        return createElement("option", {key: component.id, value: component.id, disabled: !result?.ok, title: result && !result.ok ? result.reason : undefined}, component.name)
    })
    return createElement("span", {ref: outletRef, "data-slot-path": JSON.stringify(path), style: {display: "contents"}}, ...children,
        createElement("select", {"aria-label": "Component to insert", value: selected, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { setSelected(event.target.value) }}, createElement("option", {value: ""}, "Choose component"), ...palette),
        createElement("button", {type: "button", disabled: !selected, onClick: () => { insert(selected, value.value.items.length) }}, "Insert component"),
        createElement("input", {"aria-label": "Slot text", value: text, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setText(event.target.value) }}),
        createElement("button", {type: "button", onClick: () => { if (commit(insertAtValuePath(document, metadata, library, path, value.value.items.length, newTextItem(text), callbacks))) setText("") }}, "Insert text"), error)
}

/** Decorates actual prop values, so outlets appear wherever the user's component renders them. */
export function CompositionEditor(options: CompositionEditorProps): ReactElement {
    const [message, setMessage] = useState("")
    const controls: ReactNode[] = []
    const commit = (result: SlotOperationResult) => {
        setMessage(result.ok ? "" : result.reason)
        if (result.ok) options.onChange(result.document)
    }
    function instance(node: CompositionInstance, path: ValuePath): ReactElement {
        const rendered = renderComposition({schemaVersion: 3, root: node}, options.metadata, options.library, {callbacks: options.callbacks}) as ReactElement<Record<string, unknown>>
        const props = {...rendered.props}
        for (const [name, prop] of Object.entries(node.props)) {
            if (prop.kind === "composed") props[name] = decorate(prop.value, props[name], [...path, {kind: "prop", propName: name}])
        }
        const component = options.metadata.components.find(c => c.id === node.componentId)
        if (component) for (const [name, prop] of Object.entries(component.props)) {
            if (node.props[name] !== undefined || prop.required || prop.defaultValue !== undefined) continue
            const rule = resolveSlotPolicy(component, [name])
            if (rule?.slot?.kind !== "any" && rule?.slot?.kind !== "components" && rule?.slot?.kind !== "richText") continue
            // Keep absent values out of the saved document until the first successful edit.
            const value: CompositionValue = rule.slot.kind === "richText"
                ? {kind: "richText", value: {kind: "richText", version: 1, inline: rule.slot.inline, nodes: []} as RichTextValueJson}
                : {kind: "nodes", value: {items: []}}
            const slotPath: ValuePath = [...path, {kind: "prop", propName: name}]
            const outlet = createElement(MissingOutlet, {...options, key: name, instancePath: path, propName: name, value})
            props[name] = options.renderSlot ? options.renderSlot({path: slotPath, value, children: null, outlet}) : outlet
        }
        return cloneElement(rendered, props)
    }
    function decorate(value: CompositionValue, rendered: unknown, path: ValuePath): unknown {
        switch (value.kind) {
            case "object": return Object.fromEntries(Object.entries(value.fields).map(([key, child]) => [key, decorate(child, (rendered as Record<string, unknown>)[key], [...path, {kind: "field", name: key}])]))
            case "array": {
                controls.push(createElement("fieldset", {key: JSON.stringify(path), "data-array-path": JSON.stringify(path)},
                    createElement("legend", null, path.map(step => step.kind === "prop" ? step.propName : step.kind === "field" ? step.name : step.kind).join(" / ")),
                    ...value.items.map((item, index) => createElement("span", {key: item.itemId, "data-array-item": item.itemId},
                        createElement("span", null, `Entry ${String(index + 1)}`),
                        createElement("button", {type: "button", "aria-label": "Move array entry up", disabled: index === 0, onClick: () => { commit(moveAtValuePath(options.document, options.metadata, options.library, path, index, index - 1, options.callbacks)) }}, "↑"),
                        createElement("button", {type: "button", "aria-label": "Remove array entry", onClick: () => { commit(removeAtValuePath(options.document, options.metadata, options.library, path, item.itemId, options.callbacks)) }}, "Remove")))))
                return value.items.map((item, index) => {
                    const child = decorate(item.value, (rendered as unknown[])[index], [...path, {kind: "arrayItem", itemId: item.itemId}])
                    return isValidElement(child) ? cloneElement(child, {key: item.itemId}) : child
                })
            }
            case "variant": return decorate(value.value, rendered, [...path, {kind: "variant"}])
            case "nodes":
            case "richText": {
                const children = value.kind === "richText" ? rendered as ReactNode : value.value.items.map(item => item.kind === "instance"
                    ? instance(item.instance, [...path, {kind: "slotItem", itemId: item.itemId}, {kind: "instance"}]) : item.kind === "text" ? item.value : null)
                const outlet = createElement(EditableOutlet, {...options, key: JSON.stringify(path), path, value, children})
                return options.renderSlot ? options.renderSlot({path, value, children, outlet}) : outlet
            }
            case "componentRef": {
                controls.push(createElement("label", {key: JSON.stringify(path)}, "Component reference",
                    createElement("select", {"aria-label": "Component reference", value: JSON.stringify(value.value), onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                        const component = options.metadata.components.find(c => JSON.stringify(c.external ?? {source: "project", id: c.id}) === event.target.value)
                        if (component) commit(editValue(options.document, options.metadata, options.library, path, () => ({kind: "componentRef", value: component.external ?? {source: "project", id: component.id}}), options.callbacks))
                    }}, ...options.metadata.components.map(component => {
                        const identity = component.external ?? {source: "project" as const, id: component.id}
                        const result = editValue(options.document, options.metadata, options.library, path, () => ({kind: "componentRef", value: identity}), options.callbacks)
                        return createElement("option", {key: component.id, value: JSON.stringify(identity), disabled: !result.ok}, component.name)
                    }))))
                return rendered
            }
            default: return rendered
        }
    }
    const preview = instance(options.document.root, [])
    return createElement(Fragment, null, preview, controls.length ? createElement("div", {"aria-label": "Nested value controls"}, ...controls) : null,
        message ? createElement("div", {role: "alert"}, message) : null)
}

/** Absent optional props are only materialized by a user edit, never by viewing the canvas. */
function MissingOutlet(options: CompositionEditorProps & {instancePath: ValuePath, propName: string, value: Extract<CompositionValue, {kind: "nodes" | "richText"}>}): ReactElement {
    const root = updateInstanceAtPath(options.document, options.instancePath, node => ({...node, props: {...node.props, [options.propName]: {kind: "composed", value: options.value}}})).root
    return createElement(EditableOutlet, {...options, document: {...options.document, root}, path: [...options.instancePath, {kind: "prop", propName: options.propName}], children: null})
}
