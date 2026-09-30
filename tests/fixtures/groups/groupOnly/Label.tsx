import {Text} from "@reactive-forge/schema"
import {defineComponentMetadata} from "../../../../packages/codegen/src/slotAuthoring"
export const Label = ({text}: {text: string}) => <span>{text}</span>
export const metadata = defineComponentMetadata(Label, {groups: [Text]})
