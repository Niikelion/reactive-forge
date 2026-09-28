// Third fixture component, added for tests/export.test.cjs (gate E,
// composition-to-TSX export). Deliberately exercises one prop of every
// ValueJson kind the exporter needs to serialize as source text (string,
// number, boolean, bigint, date, array, object), plus a callback-reference
// prop and nested `children` - none of which the existing Greeter/Card
// fixtures cover together. Additive only: does not change Greeter.tsx or
// Card.tsx, so tests/bundle.test.cjs, tests/runtime.test.cjs, and
// tests/editor.test.cjs (which each filter metadata.components by name) are
// unaffected by this file's presence in the same componentRoots directory.
import type {ReactNode} from "react"

export interface ExportShowcaseProps {
    title: string
    count: number
    active: boolean
    tags: string[]
    meta: { source: string }
    when: Date
    big: bigint
    children?: ReactNode
    onActivate?: () => void
}

export const ExportShowcase = ({ title, count, active, tags, meta, when, big, children, onActivate }: ExportShowcaseProps) => {
    onActivate?.()
    return (
        <section data-testid="export-showcase">
            <h1>{title}</h1>
            <span data-testid="count">{count}</span>
            <span data-testid="active">{String(active)}</span>
            <span data-testid="tags">{tags.join(",")}</span>
            <span data-testid="meta-source">{meta.source}</span>
            <span data-testid="when">{when.toISOString()}</span>
            <span data-testid="big">{big.toString()}</span>
            <div data-testid="children">{children}</div>
        </section>
    )
}
