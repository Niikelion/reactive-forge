import {FC} from "react";

type Mapped<T extends object> = { [K in keyof T]: { value: T[K], key: K } }

type Foo = { a: number, b: string }

export const WithRecord: FC<{ v: Record<string, null> }> = () => null
export const WithOmit: FC<{ v: Omit<Foo, "a"> }> = () => null
export const WithPick: FC<{ v: Pick<Foo, "a"> }> = () => null
export const WithMappedType: FC<{ v: Mapped<Foo> }> = () => null
export const WithMappedRecordType: FC<{ v: Mapped<Record<number, null>> }> = () => null

type Cyclic = number | Cyclic[]
export const WithCyclicType: FC<{ v: Cyclic }> = () => null