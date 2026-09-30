import {RichText} from "../../../../../packages/schema/src"
// Fixture for tests/export.test.cjs (composition-to-TSX export, phase 3, docs/slot-contract.md
// section 9). Additive only - does not touch SlotCard.tsx, whose own `caption` richText policy
// (marks: ["bold"] only) is exercised by tests/runtime-v2.test.cjs's "disallowed rich-text mark"
// case (phase 2, not owned by this file) and must not change. This fixture exists purely to give
// the export test a richText-policy prop that accepts BOTH "bold" and "italic" marks together, plus
// both block kinds, without touching that other test's fixed expectations - mirroring the
// established "additive fixture" precedent (see ExportShowcase.tsx's own module doc comment).
import type { ReactNode } from "react"
import { defineComponentMetadata } from "../../../../../packages/codegen/src/slotAuthoring"

export interface RichTextShowcaseProps {
    body: ReactNode
    // A bare ReactNode "nodes"-domain prop with an EXPLICIT rule that does not itself restate
    // `multiple` - unlike SlotCard's `actions` (a genuinely declared `ReactNode[]` array), this is
    // a plain ReactNode, so an export test can exercise the single-item, non-multiple "stays bare,
    // no Fragment" case for a real bare-ReactNode slot (not the declared-array case, which always
    // needs a real array literal regardless of item count - see export.ts's
    // serializeSlotArrayExpression doc comment).
    footer?: ReactNode
}

export const RichTextShowcase = ({ body, footer }: RichTextShowcaseProps) => (
    <div data-testid="richtext-showcase">
        {body}
        <div data-testid="richtext-showcase-footer">{footer}</div>
    </div>
)

export const RichTextShowcaseMetadata = defineComponentMetadata(RichTextShowcase, {
    rules: [
        { path: ["body"], slot: { kind: "components", accepts: [RichText] } },
        { path: ["footer"], slot: { kind: "any", maxItems: 1 } },
    ],
});
