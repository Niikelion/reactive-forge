import {defineComponentMetadata, Text, RichText} from "../../../../../packages/codegen/src/slotAuthoring"
/** Rich text is owned by this host, not by Forge. */
export const RichContent = ({text, italicText, inline = false}: {text: string, italicText?: string, inline?: boolean}) => {
    const content = <strong>{text}</strong>
    return <>{inline ? content : <p>{content}</p>}{italicText ? <ul><li><em>{italicText}</em></li></ul> : null}</>
}
export const TextContent = ({text}: {text: string}) => <span>{text}</span>

export const RichContentMetadata = defineComponentMetadata(RichContent, {groups: [RichText]})
export const TextContentMetadata = defineComponentMetadata(TextContent, {groups: [Text]})
