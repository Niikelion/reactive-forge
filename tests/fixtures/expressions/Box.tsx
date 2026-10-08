export interface BoxProps {
    label: string
    className?: string
    style?: {padding?: number, gap?: number, background?: string}
}

export function Box({label, className, style}: BoxProps) {
    return <div className={className} style={style}>{label}</div>
}
