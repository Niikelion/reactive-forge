// Second fixture component (tests/runtime.test.cjs, gate D part 1): proves
// nested composition (via `children`) and a callback-reference prop
// resolved through a host registry, on top of the same real bundle+metadata
// pipeline tests/bundle.test.cjs already exercises for `Greeter`.
import type {ReactNode} from "react"

export interface CardProps {
    title: string
    children?: ReactNode
    // Invoked synchronously during render (not a click handler - see
    // tests/runtime.test.cjs for why: renderToStaticMarkup has no event
    // loop, so a callback prop is proven structurally, by actually calling
    // it during the component's own render, rather than simulating an
    // interaction it cannot support).
    onRender?: () => void
}

export const Card = ({ title, children, onRender }: CardProps) => {
    onRender?.()
    return (
        <section data-testid="card">
            <h2>{title}</h2>
            <div data-testid="card-body">{children}</div>
        </section>
    )
}
