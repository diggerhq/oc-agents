import { build } from 'esbuild';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// Get all TypeScript files recursively
function getFiles(dir, files = []) {
  const items = readdirSync(dir);
  for (const item of items) {
    const path = join(dir, item);
    if (statSync(path).isDirectory()) {
      getFiles(path, files);
    } else if (item.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

const entryPoints = getFiles('./src');

await build({
  entryPoints,
  outdir: './dist',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  bundle: false,
  outExtension: { '.js': '.js' },
});

console.log('Build complete!');
