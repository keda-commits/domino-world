import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名のサブパス (/domino-world/) で配信される。
// 開発時はルートで動かすため、build のときだけ base を切り替える。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/domino-world/' : '/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
}));
