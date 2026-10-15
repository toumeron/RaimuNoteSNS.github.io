import {test} from 'node:test';import assert from 'node:assert/strict';import {storage} from './storage.mjs';
test('failed upload cleanup removes the exact B2 version, instead of leaving a hidden billable copy',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(request)=>{requests.push(request);return request.method==='HEAD'?new Response(null,{headers:{'x-amz-version-id':'synthetic-version'}}):new Response(null,{status:204});};
 try{await storage({S3_ENDPOINT:'https://s3.us-east-005.backblazeb2.com',S3_BUCKET:'test-video-bucket',S3_REGION:'us-east-005',S3_ACCESS_KEY_ID:'test-only',S3_SECRET_ACCESS_KEY:'test-only'}).delete('owner/post/video.mp4');assert.equal(requests.length,2);assert.equal(requests[1].method,'DELETE');assert.equal(new URL(requests[1].url).searchParams.get('versionId'),'synthetic-version');}finally{globalThis.fetch=original;}
});

test('retrying deletion of an already removed B2 object succeeds without adding a delete marker',async()=>{
 const original=globalThis.fetch,requests=[];globalThis.fetch=async request=>{requests.push(request);return new Response(null,{status:404});};
 try{await storage({S3_ENDPOINT:'https://s3.us-east-005.backblazeb2.com',S3_BUCKET:'test-video-bucket',S3_REGION:'us-east-005',S3_ACCESS_KEY_ID:'test-only',S3_SECRET_ACCESS_KEY:'test-only'}).delete('owner/post/gone.mp4');assert.equal(requests.length,1);assert.equal(requests[0].method,'HEAD');}finally{globalThis.fetch=original;}
});

test('concurrent removal of the same B2 version is idempotent',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async request=>request.method==='HEAD'?new Response(null,{headers:{'x-amz-version-id':'same-version'}}):new Response(null,{status:404});
 try{await storage({S3_ENDPOINT:'https://s3.us-east-005.backblazeb2.com',S3_BUCKET:'test-video-bucket',S3_REGION:'us-east-005',S3_ACCESS_KEY_ID:'test-only',S3_SECRET_ACCESS_KEY:'test-only'}).delete('owner/post/video.mp4');}finally{globalThis.fetch=original;}
});
