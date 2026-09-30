import {defineComponentMetadata, defineLibraryMetadata, externalComponent} from "../../../packages/codegen/src/slotAuthoring"
import {RichText} from "@reactive-forge/schema"
export default defineLibraryMetadata({compatibleVersions: "^1.0.0", components: [
    defineComponentMetadata(externalComponent("rf-fixture-widgets", "Button"), {groups: [RichText]})
]})
