// Fixtures for metadata diagnostics: unsupported required/optional prop
// types, literal vs. non-literal defaults, and JSDoc descriptions. `symbol`
// is used as the "unsupported type" trigger because it does not match any
// branch of extract.ts's typeToSchema (not ReactNode-assignable, not an
// array, not Date-assignable, not string/number/boolean/bigint-like, and its
// TypeFlags are neither Null, Undefined nor Object), so it reliably falls
// into the diagnostic-producing default branch.

/**
 * Component whose required `id` prop has an unsupported type.
 */
export const RequiredUnsupported = ({ id, title }: { id: symbol; title: string }) => (
  <div>{title}</div>
);

/**
 * Component whose optional `id` prop has an unsupported type.
 */
export const OptionalUnsupported = ({ id, title }: { id?: symbol; title: string }) => (
  <div>{title}</div>
);

export interface WithDefaultsProps {
  /** The size of the widget. */
  size?: string;
  scale?: number;
}

function computeScale(): number {
  return 1;
}

/**
 * Component with a literal destructured default and a non-literal one.
 */
export const WithDefaults = ({ size = 'medium', scale = computeScale() }: WithDefaultsProps) => (
  <div>
    {size}
    {scale}
  </div>
);
