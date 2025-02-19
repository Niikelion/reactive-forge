import {FC, ReactNode} from "react";

export const Row: FC<{ children?: ReactNode }> = ({children}) => {
    return <div style={{
        display: "flex",
        flexDirection: "row",
        gap: "20px"
    }}>{children}</div>
}