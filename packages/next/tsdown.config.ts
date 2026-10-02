import {definePackageConfig} from "@gamedev-sensei/tsdown-config"
export default definePackageConfig([{entry: ["src/bin.ts"], format: ["esm"], dts: false, sourcemap: false}])
