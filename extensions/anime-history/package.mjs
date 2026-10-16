import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {zipSync} from 'fflate';
const files=['manifest.json','popup.html','popup.mjs','extractor.js','service-worker.mjs','README.md'];
const contents=Object.fromEntries(await Promise.all(files.map(async file=>[file,new Uint8Array(await readFile(new URL(file,import.meta.url)))])));
for(const output of [new URL('../anime-history.zip',import.meta.url),new URL('../../public/extensions/anime-history.zip',import.meta.url)]){
 await mkdir(new URL('.',output),{recursive:true});await writeFile(output,zipSync(contents,{level:9,mtime:new Date('2026-10-18T00:00:00Z')}));console.log(`Packaged ${files.length} extension files: ${fileURLToPath(output)}`);
}
