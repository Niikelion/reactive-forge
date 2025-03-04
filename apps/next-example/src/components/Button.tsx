import {FC, ReactNode} from "react";

export const Button: FC<{
    variant?: "filled" | "outlined",
    children?: ReactNode
} & {
    onClick?: () => void
}> = ({variant, children, onClick}) =>
    <button onClick={onClick}>{variant}: {children}</button>