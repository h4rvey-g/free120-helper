import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as esbuild from 'esbuild';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
const outfile = 'dist/free120-helper.user.js';
const banner = await readFile('src/userscript.meta.txt', 'utf8');

const options = {
  entryPoints: ['src/main.js'],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100'],
  banner: { js: banner.trimEnd() },
  footer: { js: '' },
  legalComments: 'none',
  charset: 'utf8',
  sourcemap: dev ? 'inline' : false,
  minify: false,
  metafile: true,
};

await mkdir(dirname(outfile), { recursive: true });

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log(`watching src/main.js -> ${outfile}`);
} else {
  const result = await esbuild.build(options);
  await writeFile('dist/free120-helper.meta.json', JSON.stringify(result.metafile, null, 2));
}
