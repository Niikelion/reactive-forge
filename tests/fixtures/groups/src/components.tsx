import type {ReactNode} from "react"
import {defineComponentMetadata} from "../../../../packages/codegen/src/slotAuthoring"
import {NavigationItem, FormattedText, Text} from "./groups"

export const MenuLink = ({label}: {label: string}) => <a>{label}</a>
export const Description = ({children}: {children: ReactNode}) => <div>{children}</div>
export const MenuLinkMetadata = defineComponentMetadata(MenuLink, {groups: [NavigationItem, Text]})
export const DescriptionMetadata = defineComponentMetadata(Description, {rules: [
    {path: ["children"], slot: {kind: "components", accepts: [Text, FormattedText, NavigationItem, MenuLink]}}
]})
