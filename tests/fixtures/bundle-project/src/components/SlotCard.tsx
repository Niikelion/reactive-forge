// Fixture for tests/runtime-v2.test.cjs (composition runtime v2, docs/slot-contract.md sections
// 7-8, 10). Exercises, in one component, every CompositionPropValue kind phase 2 adds:
//  - `actions: ReactNode[]` - a declared array of action nodes, mirroring the contract's own
//    worked example (section 2): `["actions"]` bounds the array's own length (`collection`),
//    `["actions", each()]` bounds what a single entry may render (`slot`).
//  - `icon: ComponentType<{size?: number}>` - a componentRef-policy prop, restricted to `SlotIcon`
//    only (a `ComponentsPolicy`-free `accepts` list of exactly one project component).
//  - `caption: ReactNode` - a richText-policy prop, block-mode, accepting only the "bold" mark and
//    only paragraph blocks (not lists) - gives the acceptance test a real "disallowed mark" and
//    "disallowed block" rejection case.
//  - `header: ReactNode` - deliberately left unannotated, so it exercises the synthesized
//    `AnyNodePolicy` default (section 3) rather than an explicit rule.
//  - `children?: ReactNode` - proves v2's "children is no longer a special sibling field" (section
//    7): stored/validated/rendered exactly like `header`, through the same "nodes" prop-value kind.
import type { ReactNode, ComponentType } from "react"
import { defineComponentMetadata, each } from "../../../../../packages/codegen/src/slotAuthoring"

export interface SlotCardProps {
    header: ReactNode
    actions: ReactNode[]
    icon: ComponentType<{ size?: number }>
    caption: ReactNode
    children?: ReactNode
}

export const SlotIcon = ({ size = 16 }: { size?: number }) => (
    <svg data-testid="slot-icon" width={size} height={size} />
)

export const SlotCard = ({ header, actions, icon: Icon, caption, children }: SlotCardProps) => (
    <section data-testid="slot-card">
        <div data-testid="slot-card-header">{header}</div>
        <div data-testid="slot-card-actions">{actions}</div>
        <div data-testid="slot-card-icon"><Icon size={24} /></div>
        <div data-testid="slot-card-caption">{caption}</div>
        <div data-testid="slot-card-children">{children}</div>
    </section>
)

export const SlotCardMetadata = defineComponentMetadata(SlotCard, {
    rules: [
        { path: ["actions"], collection: { maxItems: 3 } },
        { path: ["actions", each()], slot: { kind: "any", maxItems: 1 } },
        { path: ["icon"], slot: { kind: "componentRef", accepts: [SlotIcon] } },
        { path: ["caption"], slot: { kind: "richText", inline: false, marks: ["bold"], blocks: { paragraphs: true, lists: false } } },
    ],
});
