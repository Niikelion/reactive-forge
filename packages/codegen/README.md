# @reactive-forge/codegen

Code generation part of the Reactive Forge.

This package provides function that can be used to generate metadata for react components
and cli tool that wraps around this function and also provides command for generating config file.

## Generating config

To generate config, run
```shell
npx forge init
```

and follow instructions from console.
It will create `forge.config.ts` file in your current working directory.

## Generating component metadata

First, you need to create config file.
It can be either `forge.config.ts`, `forge.config.js`, `forgerc.ts` or `forgerc.js`.
Default exported object must be assignable to `ForgeConfig` from `@reactive-forge/codegen` package.

Once you create it, you can run

```shell
npx forge codegen
```

or simply
```shell
npx forge
```

to generate argument information for your components.
Note, that generated files will use types from `@reactive-forge/shared` package,
and you will need to add it as your dependency when shipping your library to end-users.

## Config

Available options:

| Field              | Type       | Default                                                  | Description                                                                                             |
|--------------------|------------|----------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| debug              | `boolean`  | `false`                                                  | enables debug output to the console                                                                     |
| silent             | `boolean`  | `false`                                                  | disables console output except for errors                                                               |
| outDir             | `string`   | `"reactive-forge"`                                       | directory to put output files in                                                                        |
| rootDir            | `string`   | `"."`                                                    | path to the root of the project                                                                         |
| baseDir            | `string`   | `"src"`                                                  | path to the roof of the components<br/>file paths in the generated output will be relative to this path |
| componentRoots     | `string[]` | `[baseDir]`                                              | root directories to start the search for components                                                     |
| pathPrefix         | `string`   | `"@/"`                                                   | prefix of the file paths in the generated output                                                        |
| tsConfigFilePath   | `string`   | `path.resolve(rootDir, "./tsconfig.json")`               | location of tsconfig.json of the project                                                                |
| typescriptLibPath  | `string`   | `path.resolve(rootDir, "./node_modules/typescript/lib")` | path to the typescript lib folder<br/>important when using workspaces                                   |
| reactTypesFilePath | `string`   |                                                          | path to the `index.d.ts` of type for react<br/>important when using workspaces                          |