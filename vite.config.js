import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名のサブパス (/domino-world/) で配信される。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/domino-world/' : '/',
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 4000 },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
}));
