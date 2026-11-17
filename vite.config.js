import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名のサブパス (/domino-world/) で配信される。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/domino-world/' : '/',
  // 本編（index.html）と、試作ページ（proto-rail.html：鉄道勢力の試作。本編からはリンクしない）
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 4000, rollupOptions: { input: { main: 'index.html', protoRail: 'proto-rail.html' } } },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
}));
