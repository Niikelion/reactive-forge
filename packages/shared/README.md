# @reactive-forge/shared

Shared package that provides types and utilities for other Reactive Forge packages.

## ArgumentValue

Type `ArgumentValue` represents a slight superset of possible values for supported argument value.
This means, that if you can't assign your value to `ArgumentValue`, it is not supported.

## ValueTypeSchema

`ValueTypeSchema` and other `*TypeSchema` types represent schema structure that Reactive Forge operates on.
Note, that intersection types and cyclic types are not supported and need to be resolved or stripped during conversion to this schema format.

## ComponentSchema

Type of generated component metadata. Contains reference to the React component and schema of the arguments.

## ComponentFile

Type of generated file data. Contains path-like name and map of component name - component schema.

## ComponentLibrary

Type of generated component library data. Contains mapping path - file for every generated file.

## Transformations

Shared package also provides utilities for transforming schemas.

Each transformation consists of transformation function of signature: `(schema: ValueTypeSchema) => ValueTypeSchema | null`.
Notice the `null` in the return type. When returning null you declare that you don't want to modify the schema.

By default, transformations are applied starting from the leaf nodes up to the root.
This means that union members, array elements and object properties will be transformed before the schema containing them is passed to the transform function.

If you need this process to start from the top, you can specify optional `topdown` parameter that forces the application of transform function on parent nodes before child nodes.

To make code more concise, you can use `mkST` function to create the transform:

```typescript
import {mkST} from "@reactive-forge/shared";

const dateToStringTransform = mkST(schema => {
    if (schema.type !== "date") return null
    
    return { type: "string" }
})
```

You can then apply the transforms with `applySchemaTransforms`:

```typescript
import {applySchemaTransforms} from "@reactive-forge/shared";

/* ... */
const schema = applySchemaTransforms(sourceSchema, [ dataToStringTransform ])
```

## Intersections

Since intersections can't be represented in the schema, you need calculate the result of the type intersection yourself.
Fortunately, Reactive Forge provides you with the `intersectionOfSchemas(...schemas: ValueTypeSchema[]): ValueTypeSchema` that does it for you.

## Utility functions

* `isBoolean(n: unknown): boolean` - checks is value is a boolean
* `isNumber(n: unknown): boolean` - checks is value is a number
* `isString(n: unknown): boolean` - checks is value is a string
* `isObject(n: unknown): boolean` - checks is value is an object
* `isReactNode(value: ArgumentValue): boolean` - checks is value is a correct ReactNode value
* `verifyValue(value: ArgumentValue, schema: ValueTypeSchema): boolean` - checks if value conforms with the provided schema
* `isContantValueSchema(schema: ValueTypeSchema): boolean` - checks if provided schema requires value to be primitive value literal