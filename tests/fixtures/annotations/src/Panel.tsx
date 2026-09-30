import type { ReactNode } from "react";

export interface PanelProps {
  body: ReactNode;
}

export const Panel = ({ body }: PanelProps) => <div>{body}</div>;
