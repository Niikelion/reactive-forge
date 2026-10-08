---
"@reactive-forge/runtime": minor
---

Add composition expressions and locals (schemaVersion 6). A value position can hold a typed, side-effect-free expression over the document's public props and locals: literals, prop and local references, property access, objects, conditionals, match, arithmetic, comparison and boolean operators, and class lists. Validation types every expression against the position it fills; `renderComposition` evaluates them; `exportToTsx` writes locals as consts and expressions as plain TypeScript, with class lists as `clsx(...)`. Version 5 documents are unchanged.
