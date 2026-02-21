import { resolve } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';

const nodeModules = [...builtinModules, builtinModules.map(m => `node:${m}`)].flat();

export default defineConfig({
  resolve: { conditions: ['node', 'default'] },
  build: {
    sourcemap: false,
    target: 'esnext',
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      external: [...nodeModules, 'napcat-common/src/message-unique'],
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    nodeResolve(),
  ],
});
