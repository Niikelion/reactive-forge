import type { ReactNode } from "react";
import { defineComponentMetadata } from "../../../../packages/codegen/src/slotAuthoring";

export interface DynamicProps {
  body: ReactNode;
}

export const Dynamic = ({ body }: DynamicProps) => <div>{body}</div>;

const extraRules = [{ path: ["body"], slot: { kind: "any" as const } }];

// A dynamically-constructed rules array (spread from a runtime computation) - section 5:
// "diagnosed 'unsupported-annotation-expression' (warning) and ignored for that call, never
// evaluated."
export const DynamicMetadata = defineComponentMetadata(Dynamic, {
  rules: [...extraRules],
});
