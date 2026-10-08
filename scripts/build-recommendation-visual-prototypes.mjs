// Run explicitly to regenerate the pinned CLIP text prototypes. No runtime
// text model or remote inference API is needed by the application.
import {readFile,writeFile} from 'node:fs/promises';
import {env,AutoTokenizer,CLIPTextModelWithProjection} from '@huggingface/transformers';
const model='Xenova/clip-vit-base-patch32';
const revision='d15189d7028b43f1d3e65039190477f6af591c2a';
env.cacheDir='/private/tmp/lime-clip-cache';
const rows=JSON.parse(await readFile(new URL('../src/lib/recommendationVisualPrompts.json',import.meta.url),'utf8'));
const [tokenizer,encoder]=await Promise.all([AutoTokenizer.from_pretrained(model,{revision}),CLIPTextModelWithProjection.from_pretrained(model,{revision,dtype:'q8'})]);
const normalize=vector=>{const length=Math.hypot(...vector);return vector.map(value=>value/length);};
const prototypes=[];
for(const row of rows){
 const inputs=tokenizer(row.prompts,{padding:true,truncation:true});
 const {text_embeds}=await encoder(inputs);
 const vectors=text_embeds.tolist().map(normalize);
 const vector=normalize(vectors[0].map((_,i)=>vectors.reduce((sum,v)=>sum+v[i],0)/vectors.length)).map(value=>Number(value.toFixed(6)));
 prototypes.push({id:row.id,topics:row.topics,vector,vectors:vectors.map(vector=>vector.map(value=>Number(value.toFixed(6))))});
}
await writeFile(new URL('../src/lib/recommendationVisualPrototypes.json',import.meta.url),JSON.stringify({model,revision,prototypes}));
console.log(`Generated ${prototypes.length} visual prototypes.`);
