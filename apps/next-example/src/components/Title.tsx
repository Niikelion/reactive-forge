import {FC, ReactNode} from "react";

export const Title: FC<{ children?: ReactNode }> = ({children}) => <h1>{children}</h1>
export const TextTitle: FC<{ title: string }> = ({title}) => <Title>{title}</Title>