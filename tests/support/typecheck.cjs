const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
for (const name of ['schema', 'runtime', 'editor', 'codegen', 'vite', 'next']) {
  console.log(`Typecheck: ${name}`);
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', `packages/${name}/tsconfig.json`], { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
