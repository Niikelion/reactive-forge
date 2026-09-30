// Rich text data model, docs/slot-contract.md section 6. A new, sibling type to ValueJson — not a
// new ValueJson variant (ValueJson's variant union is frozen by docs/metadata-contract.md v1).
// This only ever appears inside a composition document, at a path whose effective policy is
// RichTextPolicy (SlotPolicy.ts) — defined here (packages/schema, not packages/runtime) because
// both the editor (marks UI) and the runtime (rendering) need it, mirroring where ValueJson itself
// lives for the same reason.

// Closed for v1 — extending the set is an additive, minor version change to slot-contract.md (a
// new literal added to the union), never silently accepted from unknown input.
export type RichTextMark = "bold" | "italic"

export interface RichTextTextNode {
    type: "text"
    text: string
    marks: RichTextMark[]
}

export interface RichTextParagraphNode {
    type: "paragraph"
    children: RichTextTextNode[]
}

export interface RichTextListItemNode {
    type: "listItem"
    children: RichTextTextNode[]
}

export interface RichTextListNode {
    type: "bulletList" | "orderedList"
    items: RichTextListItemNode[]
}

export type RichTextBlockNode = RichTextParagraphNode | RichTextListNode

// The value that actually lives in a composition document at a richText-policy slot. `inline` is
// restated on the value (not inferred from node shape) so a reader never has to guess which array
// form it's looking at from an empty `nodes: []`.
export type RichTextValueJson =
    | { kind: "richText", version: 1, inline: true, nodes: RichTextTextNode[] }
    | { kind: "richText", version: 1, inline: false, nodes: RichTextBlockNode[] }
