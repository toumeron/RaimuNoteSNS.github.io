// Local validation asset only. Miku is not an MIT/CC0 asset and is never bundled.
import { mkdir, writeFile } from 'node:fs/promises';
const directory = new URL('./local-models/', import.meta.url);
await mkdir(directory, { recursive: true });
const root = 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/mmd/';
for (const [source, name] of [['miku/miku_v2.pmd', 'miku_v2.pmd'], ['miku/eyeM2.bmp', 'eyeM2.bmp'], ['miku/readme_miku_v2.txt', 'readme_miku_v2.txt'], ['miku/readme.txt', 'readme.txt'], ['LICENSE', 'LICENSE'], ['Readme.txt', 'ASSET-LICENSES.txt']]) {
  const response = await fetch(root + source);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  await writeFile(new URL(name, directory), Buffer.from(await response.arrayBuffer()));
}
console.log('Local MMD sample ready. Read local-models/ASSET-LICENSES.txt and the model readme before other use.');
