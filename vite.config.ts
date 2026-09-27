import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist/client', sourcemap: false, target: 'es2022' },
});
