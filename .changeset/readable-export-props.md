---
"@reactive-forge/runtime": patch
---

Emit individual named constants for defaulted public props instead of copying every prop into a `values` object. Non-nullable defaults use `??`; explicitly nullable schemas retain undefined-only defaulting. JSX bindings and expressions share the resolved constants, with names protected against collisions with imports, locals, reserved bindings and built-in value constructors.

Use dot access for public prop names that are valid JavaScript property identifiers (including Unicode and reserved property names), and retain bracket access for other names.
