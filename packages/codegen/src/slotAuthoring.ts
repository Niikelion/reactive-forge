// Runtime implementations of the authoring API from docs/slot-contract.md section 4.
//
// Per the contract: "Author-facing component references become portable component identities,
// never functions in metadata JSON" and the handoff's "Analyze supported static declarations
// without importing/executing application modules" - codegen never calls any of these functions.
// It statically parses the *call expressions* that invoke them (see annotations/parseRules.ts).
//
// These implementations exist purely so that project/fixture `.tsx`/`.ts` files that write
// `defineComponentMetadata(Card, {rules: [...]})` actually typecheck and have a real, parseable
// call site - not because anything ever executes them for their return value. Each one is a
// trivial passthrough/identity.
//
// `each`/`variant` are `@reactive-forge/schema` exports (`packages/schema/src/schema/SlotPath.ts`)
// per the contract's section 2 cross-reference ("the authoring helper") - re-exported below rather
// than duplicated, now that the schema/path-helpers worker has landed them.
//
// External component references: `defineComponentMetadata`'s first argument is typed to accept a
// real component value (`FC<P> | ComponentType<P>`) for the colocated case, matching the
// contract's signature exactly. For a companion library-metadata module (section 5), the
// annotated component is never imported as a runtime value (that would require executing/
// resolving the third-party package) - `externalComponent(...)` below is this package's own,
// explicitly *not-in-the-frozen-contract*, lightweight marker for that case. It is a judgment
// call: the contract does not specify how a `defineLibraryMetadata` author spells "this rule
// targets an export I do not want to import." Flagged for the coordinator in the final report.

import type { FC, ComponentType } from "react"
import { each, variant } from "@reactive-forge/schema"
import type { ComponentMetadataSource, LibraryMetadataSource, PathSegment, SlotRule } from "./slotTypes.js"

export interface ExternalComponentRef {
    readonly __rfExternalRef: true
    readonly package: string
    readonly exportName: string
    readonly subpath?: string
    readonly isDefault: boolean
}

export function externalComponent(
    packageSpecifier: string,
    exportName: string,
    options?: { subpath?: string, isDefault?: boolean }
): ExternalComponentRef {
    return {
        __rfExternalRef: true,
        package: packageSpecifier,
        exportName,
        subpath: options?.subpath,
        isDefault: options?.isDefault ?? false
    }
}

export function defineComponentMetadata<P>(
    component: FC<P> | ComponentType<P> | ExternalComponentRef,
    config: { rules?: SlotRule[] }
): ComponentMetadataSource {
    return { rules: config.rules ?? [] }
}

export function defineLibraryMetadata(config: {
    compatibleVersions: string
    components: ComponentMetadataSource[]
}): LibraryMetadataSource {
    return config
}

export { each, variant }
export type { PathSegment }
