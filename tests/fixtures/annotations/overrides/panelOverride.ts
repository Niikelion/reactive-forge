import { Panel } from "../src/Panel";
import { defineComponentMetadata } from "../../../../packages/codegen/src/slotAuthoring";

// Project override source (docs/slot-contract.md section 5's `overrideSources`) - "the
// integrating project saying 'for *my* usage of this component, further restrict/relax this
// path.'" Targets the same ["body"] path Panel.metadata.ts's library-layer rule sets, at a higher
// `maxItems` - proves project-layer precedence over library/colocated (section 4).
export default defineComponentMetadata(Panel, {
  rules: [{ path: ["body"], slot: { kind: "any", maxItems: 9 } }],
});
