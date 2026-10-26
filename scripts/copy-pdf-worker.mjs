import { mkdir, copyFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = require('pdfjs-dist/package.json');
await mkdir('public/pdfjs', { recursive: true });
await copyFile(join(root, 'build/pdf.worker.min.mjs'), `public/pdfjs/pdf.worker-${version}.min.mjs`);
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(join(root, directory), `public/pdfjs/${directory}`, { recursive: true });
}
