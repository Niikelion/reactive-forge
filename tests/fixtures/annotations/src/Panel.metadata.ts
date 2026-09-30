import { Panel } from "./Panel";
import { defineComponentMetadata } from "../../../../packages/codegen/src/slotAuthoring";

// The "*.metadata.ts sibling file" colocated form (docs/slot-contract.md section 5), as opposed to
// Card.tsx's "same source file" form.
export default defineComponentMetadata(Panel, {
  rules: [{ path: ["body"], slot: { kind: "any", maxItems: 2 } }],
});
