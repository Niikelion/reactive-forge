// Fixture for tests/runtime-v3.test.cjs (recursive composition values and policy enforcement,
// docs/slot-contract-recursive.md). Additive only - does not touch SlotCard.tsx/RichTextShowcase.tsx,
// whose own rules other tests (tests/runtime-v2.test.cjs, tests/editor.test.cjs,
// tests/export.test.cjs, tests/editor-demo.test.cjs) still depend on unchanged. A new component is
// cleaner here than extending either of those: neither has a nested-object-with-a-slot-prop
// (`content.header.title`-shaped) or an array-of-objects-with-a-slot-prop (`sections.each().body`-
// shaped) path today, and this fixture's whole purpose IS those two shapes plus a real
// multi-node-per-array-entry case (worked example 8.3) - bolting that onto an existing fixture
// would risk perturbing its established, depended-upon rule set.
import type { ReactNode } from "react"
import { defineComponentMetadata, each } from "../../../../../packages/codegen/src/slotAuthoring"

export interface NestedSlotCardHeader {
    title: ReactNode
    subtitle: string
}

export interface NestedSlotCardContent {
    header: NestedSlotCardHeader
}

export interface NestedSlotCardSection {
    heading: string
    body: ReactNode
}

export interface NestedSlotCardProps {
    // Worked example 8.1 (docs/slot-contract-recursive.md section 8.1): content.header.title -
    // a richText-policy ReactNode nested two plain-object levels deep.
    content: NestedSlotCardContent
    // Worked example 8.2: sections.each().body - an array of objects, each with its own
    // independent ReactNode slot prop.
    sections: NestedSlotCardSection[]
    // Worked example 8.3: actions - a declared ReactNode[] with NO intervening object, each()
    // landing directly on ReactNode, and a per-entry maxItems high enough (2) to prove a single
    // array entry can hold more than one rendered node - the literal flat-array-gap closure.
    actions: ReactNode[]
}

export const NestedSlotCard = ({ content, sections, actions }: NestedSlotCardProps) => (
    <section data-testid="nested-slot-card">
        <div data-testid="nested-slot-card-title">{content.header.title}</div>
        <div data-testid="nested-slot-card-subtitle">{content.header.subtitle}</div>
        <ul data-testid="nested-slot-card-sections">
            {sections.map((section, i) => (
                <li key={i} data-testid="nested-slot-card-section">
                    <span data-testid="nested-slot-card-section-heading">{section.heading}</span>
                    <span data-testid="nested-slot-card-section-body">{section.body}</span>
                </li>
            ))}
        </ul>
        <div data-testid="nested-slot-card-actions">{actions}</div>
    </section>
)

export const NestedSlotCardMetadata = defineComponentMetadata(NestedSlotCard, {
    rules: [
        { path: ["content", "header", "title"], slot: { kind: "richText", inline: true, marks: ["bold"] } },
        { path: ["sections"], collection: { maxItems: 5 } },
        { path: ["sections", each(), "body"], slot: { kind: "any", multiple: true, maxItems: 3 } },
        { path: ["actions"], collection: { maxItems: 3 } },
        { path: ["actions", each()], slot: { kind: "any", multiple: true, maxItems: 2 } },
    ],
});
