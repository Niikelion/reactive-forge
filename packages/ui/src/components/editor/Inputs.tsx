import {Children, FC, InputHTMLAttributes, ReactNode, useState} from "react";
import {isBoolean} from "@reactive-forge/shared";

type ValueInputProps<T> = {
    value: T
    onValueChanged(value: T): void
    error?: string
}
type ValueInput<T> = FC<ValueInputProps<T>>

const ConstantInput: FC<{ value: string }> = ({ value }) => <span>{value}</span>
const GenericInput: FC<ValueInputProps<string> & Pick<InputHTMLAttributes<HTMLInputElement>, "type">> = ({ value, onValueChanged, error, type }) =>
    <label>
        {error}
        <input type={type} value={value} onChange={e => onValueChanged(e.currentTarget.value)} />
    </label>

export const NullInput: FC = () => <ConstantInput value="null" />
export const UndefinedInput: FC = () => <ConstantInput value="undefined" />
export const TextInput: ValueInput<string> = props =>
    <GenericInput {...props} type="text" />
export const NumberInput: ValueInput<number> = ({ value, onValueChanged, ...props }) =>
    <GenericInput {...props} value={value.toString()} onValueChanged={v => onValueChanged(parseFloat(v))} type="number" />
export const BooleanInput: ValueInput<boolean> = ({ value, onValueChanged, error }) =>
    <label>
        {error}
        <input type="checkbox" checked={value} onChange={e => onValueChanged(e.currentTarget.checked)} />
    </label>
export const DateInput: ValueInput<Date> = ({ value, onValueChanged, error }) =>
    <label>
        {error}
        <input type="date" value={value.toISOString()} onChange={e => onValueChanged(new Date(e.currentTarget.value))} />
    </label>
export const DropdownInput: FC<ValueInputProps<number> & { options: string[] }> = ({ value, onValueChanged, error, options }) =>
    <label>
        {error}
        <select value={options[value]} onChange={e => onValueChanged(e.currentTarget.selectedIndex)}>
            {options.map(option =>
                <option key={option} value={option}>{option}</option>
            )}
        </select>
    </label>
export const List: FC<{ type: "ordered" | "unordered", children?: ReactNode }> = ({ type, children }) => {
    switch (type) {
        case "ordered": return <ol>
            {children}
        </ol>
        case "unordered": return <ul>
            {children}
        </ul>
    }
}
type ArrayItemInputProps = {
    required: boolean
    onInsertBefore(): void
    onDelete(): void
    children?: ReactNode
}
export const ArrayItemInput: FC<ArrayItemInputProps> = ({ required, onInsertBefore, onDelete, children }) =>
    <li style={{ display: "flex", flexDirection: "row", gap: "10px" }}>
        {!required && <button onClick={() => onInsertBefore()}>+</button>}
        {!required && Children.count(children) > 0 && <button onClick={() => onDelete()}>-</button>}
        {children}
    </li>
type ObjectPropertyInputProps = {
    name: string
    type: "required" | "optional" | "index"
    onDelete?(): void
    onRename?(newName: string): void
    children?: ReactNode
}
export const ObjectPropertyInput: FC<ObjectPropertyInputProps> = ({ name, type, onDelete, onRename, children }) => {
    const [ tmpName, setTmpName ] = useState(name)

    const canBeDeleted = type !== "required"
    const canBeRenamed = type === "index"

    return <li style={{display: "flex", flexDirection: "row", gap: "10px"}}>
        {canBeRenamed && <button onClick={() => onRename && onRename(tmpName)}>{">"}</button>}
        {canBeDeleted && <button onClick={onDelete}>-</button>}
        {canBeRenamed ? (
            <>
                <input type="text" value={tmpName} onChange={e => setTmpName(e.currentTarget.value)} />
                <span>:</span>
            </>
        ) : <span>{name}:</span>}
        {children}
    </li>;
}
type ObjectNewPropertyInput = {
    onAdd(name: string): void
    namesToSuggest: string[]
    allowCustomNames: boolean
}
export const ObjectNewPropertyInput: FC<ObjectNewPropertyInput> = ({ onAdd, namesToSuggest, allowCustomNames }) => {
    const [ tmpName, setTmpName ] = useState("")

    return (
        <span>
            <button onClick={() => {
                if (!allowCustomNames && !namesToSuggest.includes(tmpName)) return

                onAdd(tmpName)
                setTmpName("")
            }}>+</button>
            <input type="text" value={tmpName} onChange={e => setTmpName(e.currentTarget.value)} />
        </span>
    )
}