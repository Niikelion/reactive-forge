// Deliberately OUTSIDE componentRoots (forge.config.ts only selects
// ./src/components). Represents "unrelated application entry code" per
// docs/claude-handoff.md gate C acceptance: "An unrelated application
// entry/route is not pulled into the fixture bundle." Never extracted,
// never imported by the generated registry, so it must never appear in
// out/bundle.js. tests/bundle.test.cjs greps the built bundle for the
// marker string below and asserts it is absent.
export const UNRELATED_APP_ENTRY_MARKER = "UNRELATED_APP_ENTRY_MARKER_f3c9a7"

export function main() {
    console.log(UNRELATED_APP_ENTRY_MARKER)
}
