import {UserConfig} from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default {
  plugins: [react()],
  optimizeDeps: { include: [ "@reactive-forge/ui" ] }
} satisfies UserConfig
