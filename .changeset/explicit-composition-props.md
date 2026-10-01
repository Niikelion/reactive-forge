---
"@reactive-forge/runtime": minor
"@reactive-forge/editor": minor
---

Add explicit public prop declarations and general recursive prop bindings for composition documents. Generated TSX exposes only the declared API, with portable schema types or explicitly referenced component prop types; it never injects a callback registry or invents inputs from callback names. Live rendering and editor previews accept declared input values, and validation diagnoses undeclared or incompatible bindings.

Legacy callback references remain supported in live rendering but must be explicitly converted to declared function props before TSX export.
