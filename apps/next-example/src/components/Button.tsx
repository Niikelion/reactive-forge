import {FC, ReactNode} from "react";

export const Button: FC<{
    variant?: "filled" | "outlined",
    children?: ReactNode
}> = ({variant, children}) =>
    <button>{variant}: {children}</button>