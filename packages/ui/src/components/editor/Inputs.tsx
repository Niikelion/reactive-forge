import {Children, FC, InputHTMLAttributes, ReactNode, useState} from "react";

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
    onInsertBefore(): void
    onDelete(): void
    children?: ReactNode
}
export const ArrayItemInput: FC<ArrayItemInputProps> = ({ onInsertBefore, onDelete, children }) =>
    <li style={{ display: "flex", flexDirection: "row", gap: "10px" }}>
        <button onClick={() => onInsertBefore()}>+</button>
        {Children.count(children) > 0 && <button onClick={() => onDelete()}>-</button>}
        {children}
    </li>
type ObjectPropertyInputProps = {
    name: string
    required: boolean
    onEnable(): void
    onDisable(): void
    children?: ReactNode
}
export const ObjectPropertyInput: FC<ObjectPropertyInputProps> = ({ name, required, onEnable, onDisable, children }) =>
    <li style={{ display: "flex", flexDirection: "row", gap: "10px" }}>
        {!required && <BooleanInput value={Children.count(children) > 0} onValueChanged={v => v ? onEnable() : onDisable()} />}
        <span>{name}:</span>
        {children}
    </li>
type ObjectIndexInputProps = {
    name: string
    onRename(n: string): void
    onDelete(): void
    children?: ReactNode
}
export const ObjectIndexInput: FC<ObjectIndexInputProps> = ({ name, onRename, onDelete, children }) => {
    const [ tmpName, setTmpName ] = useState(name)
    return <li style={{display: "flex", flexDirection: "row", gap: "10px"}}>
        <button onClick={() => onRename(tmpName)}>{">"}</button>
        <button onClick={onDelete}>-</button>
        <input type="text" value={tmpName} onChange={e => setTmpName(e.currentTarget.value)} />
        {children}
    </li>;
}