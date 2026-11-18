// Start a new clip project from the bundled template.
//   node new-clip.mjs <target-folder>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target) {
  console.error('usage: node new-clip.mjs <target-folder>   e.g. node new-clip.mjs knee-clip');
  process.exit(1);
}
const dest = path.resolve(target);
if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
  console.error(`${dest} already exists and is not empty - choose another folder.`);
  process.exit(1);
}
const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'template');
fs.cpSync(template, dest, { recursive: true });

const name = path.basename(dest).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
const pkgFile = path.join(dest, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.name = name;
pkg.description = 'Pixel-style explainer clip rendered from code';
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

// name the output after the project
for (const f of ['tools/build.mjs', 'build-clip.bat', 'README.md']) {
  const p = path.join(dest, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('shoulder-clip', name));
}
console.log(`created ${dest}`);
console.log('next: npm install, then edit src/timeline.js (see references/architecture.md)');
