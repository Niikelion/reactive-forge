import {ReactNode} from "react";

export type ArgumentValue =
    | ArgumentValue[]
    | { [k:string]: ArgumentValue }
    | ((...args: ArgumentValue[]) => ArgumentValue)
    | string
    | number
    | boolean
    | null
    | undefined
    | Date
    | ReactNode