import type { ReactNode } from "react";
import { defineComponentMetadata, each } from "../../../../packages/codegen/src/slotAuthoring";

// The docs/slot-contract.md section 2 worked example, almost verbatim: `actions` is a declared
// array of action nodes (a `collection` rule bounds the array's own length), while
// `["actions", each()]` bounds what a single entry may render.
export interface CardProps {
  header: ReactNode;
  actions: ReactNode[];
}

export const Card = ({ header, actions }: CardProps) => (
  <div>
    {header}
    {actions}
  </div>
);

export const CardMetadata = defineComponentMetadata(Card, {
  rules: [
    { path: ["actions"], collection: { maxItems: 3 } },
    { path: ["actions", each()], slot: { kind: "any", maxItems: 1 } },
  ],
});
