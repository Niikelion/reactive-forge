import type { ReactNode } from 'react';

// Mirrors the primitive props and nested children used by historical examples.
export const Card = ({ title, count, children }: { title: string; count?: number; children?: ReactNode }) => (
  <section><h2>{title}</h2><span>{count}</span>{children}</section>
);

export default function DefaultCard({ title }: { title: string }) {
  return <article>{title}</article>;
}

const PrivateCard = () => <aside />;
void PrivateCard;
export const notAComponent = { title: 'configuration' };
