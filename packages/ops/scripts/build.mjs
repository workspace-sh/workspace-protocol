// Builds the static page: src/index.html with the browser code inlined, into
// dist/. The worker (src/worker.ts) is bundled by Wrangler on deploy.

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({ entryPoints: [join(root, 'src/client.ts')], bundle: true, format: 'esm', minify: true, write: false, target: 'es2022' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(root, 'src/index.html'), 'utf8').replace('/*APP*/', () => js);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
writeFileSync(join(root, 'dist/_headers'), readFileSync(join(root, 'src/_headers')));
console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB`);
