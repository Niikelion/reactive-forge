# Class values: implementation and usage

Implemented: Date, URL, Map, Set, RegExp, and explicitly registered custom classes. The Money fixture exercises private state, methods, generic specialization, preview, exported TSX, and bundled adapters.

## Register a custom class

Add a static binding to ForgeConfig. Paths in `type.module` and relative `runtime.module` are relative to rootDir. Application class and adapter modules are inspected/imported into generated code, never executed during extraction.

```ts
classBindings: [{
  type: {module: "./src/money", exportName: "Money"},
  id: "shop/Money",
  version: 1,
  payloadSchema: {
    type: "object",
    properties: {
      amount: {schema: {type: "number"}, required: true},
      currency: {schema: {type: "string"}, required: true},
    },
  },
  runtime: {module: "./src/money-adapter", exportName: "moneyAdapter"},
}]
```

The runtime module exports an adapter object, not merely a factory:

```ts
import type {ValueAdapter} from "@reactive-forge/schema"
import {Money} from "./money"

function validateMoney(data: unknown): void {
  const value = data as {amount?: unknown; currency?: unknown} | null
  if (!value || typeof value.amount !== "number" ||
      !Number.isInteger(value.amount) || value.amount < 0 ||
      typeof value.currency !== "string") throw new Error("Invalid money")
}

export function moneyFromData(data: unknown): Money {
  validateMoney(data)
  const value = data as {amount: number; currency: string}
  return new Money(value.amount, value.currency)
}

export const moneyAdapter: ValueAdapter = {
  id: "shop/Money",
  version: 1,
  typeRef: {kind: "project", sourcePath: "src/money.ts", exportName: "Money"},
  validateData: validateMoney,
  fromData: moneyFromData,
  // Optional: needed only to serialize existing live instances.
  toData: value => {
    if (!(value instanceof Money)) throw new Error("Expected Money")
    return {amount: value.amount, currency: value.currency}
  },
  // Import path relative to the final exported TSX file, or a package specifier.
  export: {module: "./src/money-adapter", exportName: "moneyFromData"},
}
```

Read the emitted `props.money.schema.typeRef` when matching a class identity. Project identity uses its declaration path/name. Bound package classes use their public module/export. Generic bindings require explicit `typeArguments: SchemaJson[]`; provide a separate binding/ID for each supported specialization. No inferred constructor arguments or reflection-based serialization.

## Runtime and editor

Generated `components.valueAdapters` contains configured runtime adapters and their bundled dependencies. `renderComposition` and `exportToTsx` also accept `options.valueAdapters`; validation consumes `library.valueAdapters`. Global URL support is available without registration as `builtin/URL`, version 1, with an absolute string payload.

`InstanceSchema` and the `instance` ValueJson tag preserve class identity and adapter versions. Instance values remain inside ordinary composition leaves. Metadata using class schemas is version 3; composition documents with class values must use version 4. Existing version-3 compositions without class values remain valid; earlier migrations are unchanged. To upgrade a version-3 document structurally, copy it with `schemaVersion: 4` before adding class values.

Schema validation verifies the payload; runtime validation also verifies the adapter identity/version and calls `validateData`. Validation never calls custom `fromData`. With nested class payloads, semantic validation sees their decoded payload data, not constructed instances. Preview then constructs real instances. Construction failures carry component/prop diagnostics. Export imports the adapter's factory, aliases colliding names, and reuses repeated factory imports.

`encodeAdapterValue(schema, liveValue, registry)` uses `toData` to serialize existing values; missing serialization capability and cycles are rejected. `decodeAdapterValue` is a low-level helper for already validated values; use `validateAdapterValue` before calling it directly.

The default instance control edits payload fields rather than public/private class members. Object payloads have labeled fields, while array payloads use the existing JSON fallback. Custom controls use the existing `instance:<hint>` control override mechanism. Unbound classes display an adapter-required message. URL edits reject invalid absolute URLs. Date editing explicitly displays UTC date and time and preserves seconds/milliseconds; existing date wire values remain unchanged.

## Scope limits

- Map payloads are arrays of key/value pairs, constrained by both generic types. Set payloads are arrays constrained by their element type. Insertion order is preserved; duplicates follow native Map/Set behavior. RegExp payloads contain source, flags, and lastIndex; invalid patterns/flags and nonnegative-safe-integer violations are rejected. Object keys/elements follow tree-value semantics and do not preserve shared reference identity. Other built-ins need explicit adapters.
- Constructor references (`typeof Money`) are diagnosed as unsupported. Date subclasses require explicit adapters. Recursive types are bounded instead of expanded indefinitely.
- Class payloads are slot-free trees: React elements, cycles and shared object identity are unsupported. Instance identity across renders is not guaranteed.
- Runtime factories and validators are trusted application code. Export descriptors must point to an importable factory with equivalent behavior to `fromData`.
- Bindings are supplied through codegen configuration, which may import a companion library's static binding list. A dedicated colocated adapter annotation helper is not included. Studio integration/deployment is separate.

## Verification

Tests in tests/class-values.test.cjs cover class identity and generics/reexports, Date subclasses, invalid dates, Money private state, constructor-free validation, error paths, unknown versions/adapters, nested values, serialization, editor fields/UTC precision, exported TSX compilation/render parity, and generated registry bundling. Map, Set and RegExp tests additionally verify generic payload constraints, native duplicate behavior and RegExp state. Verification: 155 strict regression tests passed; build, typecheck, lint, and package-export checks passed.
