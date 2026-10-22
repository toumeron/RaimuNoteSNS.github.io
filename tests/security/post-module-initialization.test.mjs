// @vitest-environment node
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';

it('initializes the real post APIs when a provider reads posts before reply exports initialize',()=>{
 // Native ESM enforces the temporal dead zone; transformed test modules can hide it.
 const script=String.raw`
 import vm from 'node:vm';
 import fs from 'node:fs';
 import ts from 'typescript';
 import assert from 'node:assert/strict';
 const sources=new Map(['posts','external-posts'].map(id=>[id,ts.transpileModule(fs.readFileSync('src/api/'+id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText]));
 const identify=specifier=>specifier.endsWith('/external-posts')||specifier==='./external-posts'?'external-posts':specifier.endsWith('/posts')||specifier==='./posts'?'posts':specifier.endsWith('/bluesky')?'provider':specifier;
 sources.set('provider',"import './posts'; export function fetchBlueskyPost() {} export function fetchBlueskyPostActivity() {}");
 const imports=new Map();
 for(const source of sources.values()){
  const ast=ts.createSourceFile('module.js',source,ts.ScriptTarget.Latest,true);
  for(const node of ast.statements){
   if(!ts.isImportDeclaration(node)||!node.importClause)continue;
   const id=identify(node.moduleSpecifier.text),names=imports.get(id)??new Set();
   if(node.importClause.name)names.add('default');
   for(const binding of node.importClause.namedBindings?.elements??[])names.add((binding.propertyName??binding.name).text);
   imports.set(id,names);
  }
 }
 const modules=new Map([...sources].map(([id,source])=>[id,new vm.SourceTextModule(source,{identifier:id})]));
 for(const [id,names]of imports)if(!modules.has(id))modules.set(id,new vm.SyntheticModule([...names],function(){for(const name of names)this.setExport(name,()=>{});}));
 const entry=modules.get('external-posts');
 await entry.link(specifier=>modules.get(identify(specifier)));
 await entry.evaluate();
 assert.equal(typeof modules.get('posts').namespace.getPostById,'function');
 assert.match(entry.namespace.REPLY_REPOST_SELECT,/replying_to:parent_comment_id/);
 `;
 expect(()=>execFileSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script],{encoding:'utf8',stdio:'pipe'})).not.toThrow();
});

it('loads catalog providers with its minimal window shim and no document',()=>{
 const script=String.raw`
 import {createServer} from 'vite';
 const storage=new Map();
 globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 globalThis.window={location:{origin:'http://localhost:8080',href:'http://localhost:8080'},localStorage,addEventListener(){},removeEventListener(){}};
 const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://catalog.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('public-catalog-no-authentication')}});
 try {
  for(const module of ['/src/lib/bluesky.ts','/src/lib/fxTwitter.ts','/src/lib/utils.ts','/src/lib/recommendationVisual.ts']) await server.ssrLoadModule(module);
 } finally {await server.close();}
 `;
 expect(()=>execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',stdio:'pipe',timeout:30000})).not.toThrow();
},35000);
