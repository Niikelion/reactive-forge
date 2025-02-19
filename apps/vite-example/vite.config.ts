import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react-swc'
import {reactiveForge} from "@reactive-forge/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), reactiveForge({
    componentRoots: [ "src/components" ],
    baseDir: "src/components"
  })],
  optimizeDeps: { include: [ "@reactive-forge/ui" ] }
})
