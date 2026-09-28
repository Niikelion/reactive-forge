import type { ReactNode } from "react";
import { defineComponentMetadata } from "../../../../packages/codegen/src/slotAuthoring";

export interface ToolbarProps {
  items: ReactNode;
}

export const Toolbar = ({ items }: ToolbarProps) => <div>{items}</div>;

// Two rules in the same (colocated/library) layer targeting the identical canonical path
// ["items"], disagreeing on maxItems - docs/slot-contract.md section 4 "Same-layer conflicts".
// The first rule wins for the conflicting field; both are still diagnosed via
// "slot-rule-conflict".
export const ToolbarMetadata = defineComponentMetadata(Toolbar, {
  rules: [
    { path: ["items"], slot: { kind: "any", maxItems: 2 } },
    { path: ["items"], slot: { kind: "any", maxItems: 5 } },
  ],
});
