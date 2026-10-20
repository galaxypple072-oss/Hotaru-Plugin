import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  base: './',
  resolve: { alias: { path: 'path-browserify' } },
  plugins: [{
    name: 'live2d-webkit-texture-url',
    transform(source, id) {
      if (!id.includes('live2d-renderer/build/renderer/Live2DCubismModel.js')) return;
      return source
        .replace('let basename = link instanceof ArrayBuffer ? "." : path_1.default.dirname(link);', 'let basename = link instanceof ArrayBuffer ? "." : new URL(".", link).href;')
        .replace('const filePath = path_1.default.join(basename, filename);', 'const filePath = new URL(filename, basename).href;')
        .replace('img.src = url;', 'img.src = isZip ? url : new URL(filename, basename).href;');
    },
  }],
  build: { outDir: path.resolve('dist'), emptyOutDir: true },
});
