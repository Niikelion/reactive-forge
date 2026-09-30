// Test-only TypeScript loader: exercises source, never stale dist output.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === '@reactive-forge/schema') request = path.join(root, 'packages/schema/src/index.ts');
  if (request.startsWith('@/') && parent?.filename.startsWith(path.join(root, 'packages/schema/src'))) {
    request = path.join(root, 'packages/schema/src', request.slice(2));
  }
  if (request.startsWith('.') && request.endsWith('.js') && parent?.filename.endsWith('.ts')) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) request = source;
  }
  return resolve.call(this, request, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) {
  Module._extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    });
    module._compile(outputText, filename);
  };
}
