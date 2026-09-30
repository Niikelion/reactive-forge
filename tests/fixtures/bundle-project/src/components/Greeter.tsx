// Public, selected component: this is what tests/bundle.test.cjs and the
// independent-host fixture actually render. Deliberately simple - proving
// the bundle/host pipeline, not component authoring.
export interface GreeterProps {
    name: string
    times?: number
}

export const Greeter = ({ name, times = 1 }: GreeterProps) => (
    <div data-testid="greeter">
        {Array.from({ length: times }, (_, i) => (
            <span key={i}>Hello, {name}!</span>
        ))}
    </div>
)
