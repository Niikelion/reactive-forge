import type {ReactNode} from 'react'

export interface HostProps {
    title: string
    count: number
    onActivate: (label: string, count: number) => string
    content: {heading: ReactNode, labels: string[]}
    children: ReactNode
    subtitle?: string | null
    date?: Date
}

export function Host({title, count, onActivate, content, children, subtitle, date}: HostProps) {
    return <article><h1>{title}</h1><p>{onActivate(title, count)}</p><header>{content.heading}</header><aside>{content.labels.join(',')}</aside>{children}{subtitle !== undefined && <small>{subtitle}</small>}{date !== undefined && <time>{date.toISOString()}</time>}</article>
}
