// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(os.tmpdir(), 'community-document-test-'));
const service = path.join(root, 'server.mjs'), secret = randomBytes(32).toString('hex');
require('../../studio/node_modules/esbuild').buildSync({entryPoints:[fileURLToPath(new URL('./server.ts',import.meta.url))],bundle:true,platform:'node',target:'node24',format:'esm',outfile:service});
const base = 'http://127.0.0.1:13314';
const child = spawn(process.execPath,[service],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'13314',DOCUMENT_HOST:'127.0.0.1',DOCUMENT_STORAGE_ROOT:root,DOCUMENT_ENGINE_ENTRY:path.resolve('services/documents/dist/engine.cjs'),DOCUMENT_SERVICE_SECRET:secret}});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const headers = owner => ({authorization:'Bearer '+secret,'x-document-owner':`user-${owner||1}`});
async function request(url,options={},owner=1) {return fetch(base+'/'+url,{...options,headers:{...headers(owner),...options.headers}});}
async function json(url,options={},owner=1) {const res=await request(url,options,owner);return {status:res.status,data:await res.json()};}
const req=(format,extra={})=>({sessionId:'test-session',instruction:'测试文件',model:'fixture-model',provider:'OpenAI',format,...extra});
const post=(plan,requestBody,key=randomUUID())=>({method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({plan,request:requestBody})});
async function done(job){for(let i=0;i<100;i++){const result=await json('jobs/'+job.id);if(['ready','failed','cancelled'].includes(result.data.status))return result.data;await new Promise(r=>setTimeout(r,100));}throw Error('job timed out');}
const results=[];async function test(name,fn){await fn();results.push(name);console.log('PASS '+name);}
let word,sheet;
try {
 for(let i=0;i<100;i++){try {if((await fetch(base+'/health')).ok)break;}catch{} if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}
 await test('private service rejects missing auth and forged owners',async()=>{
  assert.equal((await fetch(base+'/assets')).status,401);assert.equal((await request('assets',{},'../escape')).status,401);
 });
 await test('Word generation, actual ZIP download, idempotency and account isolation',async()=>{
  const plan={schemaVersion:1,kind:'create_word',fileName:'会议纪要.docx',blocks:[{type:'paragraph',text:'项目会议纪要',style:'title'},{type:'paragraph',text:'交付日期为周五。'}]};
  const key=randomUUID(),options=post(plan,req('docx'),key);const start=await json('jobs',options);assert.equal(start.status,202);word=await done(start.data);assert.equal(word.status,'ready',JSON.stringify(word));
  const download=await request(`assets/${word.assetId}/1/download`);assert.equal(download.status,200);assert.equal(Buffer.from(await download.arrayBuffer()).readUInt32LE(),0x04034b50);
  assert.equal((await json('jobs',options)).data.assetId,word.assetId);assert.equal((await json('assets')).data.assets.length,1);
  assert.equal((await json('jobs',post({...plan,fileName:'不同.docx'},req('docx'),key))).status,409);
  assert.deepEqual((await json('assets',{},2)).data.assets,[]);assert.equal((await request(`assets/${word.assetId}/1/download`,{},2)).status,404);assert.equal((await json('jobs/'+word.id,{},2)).status,404);
 });
 await test('uploaded document keeps original bytes and obtains verified content',async()=>{
  const original=Buffer.from(await (await request(`assets/${word.assetId}/1/download`)).arrayBuffer());
  const start=await json('upload',{method:'POST',headers:{'idempotency-key':randomUUID(),'x-file-name':encodeURIComponent('原件.docx'),'x-chat-session':'test-session','content-type':'application/octet-stream'},body:original});assert.equal(start.status,202);
  const uploaded=await done(start.data);assert.equal(uploaded.status,'ready');assert.deepEqual(Buffer.from(await (await request(`assets/${uploaded.assetId}/1/download`)).arrayBuffer()),original);
 });
 await test('Excel formulas, zero-padded text, edits, old versions and stale-write rejection',async()=>{
  const plan={schemaVersion:1,kind:'create_workbook',fileName:'销售.xlsx',sheets:[{name:'销售',cells:[{address:'A1',value:{type:'text',value:'0012'}},{address:'B1',value:{type:'number',value:3}},{address:'C1',value:{type:'number',value:20}},{address:'D1',value:{type:'formula',value:'=B1*C1'}}]},{name:'汇总',cells:[{address:'A1',value:{type:'formula',value:"='销售'!D1"}}]}]};
  sheet=await done((await json('jobs',post(plan,req('xlsx')))).data);assert.equal(sheet.status,'ready',JSON.stringify(sheet));
  const original=Buffer.from(await (await request(`assets/${sheet.assetId}/1/download`)).arrayBuffer());
  const before=(await json(`assets/${sheet.assetId}/1/structure`)).data;assert.equal(before.sheets[0].cells.find(c=>c.address==='A1').value.value,'0012');assert.equal(before.sheets[0].cells.find(c=>c.address==='D1').cachedValue.value,60);
  const edit={schemaVersion:1,kind:'edit',sourceArtifactId:sheet.assetId,baseVersion:1,operations:[{op:'set_cell',sheetId:'sheet-0',address:'C1',expectedOldValue:{type:'number',value:20},value:{type:'number',value:30}}]};
  const requestBody=req('xlsx',{sourceArtifactId:sheet.assetId,baseVersion:1});
  const changed=await done((await json('jobs',post(edit,requestBody))).data);assert.equal(changed.status,'ready');assert.equal(changed.version,2);
  const after=(await json(`assets/${sheet.assetId}/2/structure`)).data;assert.equal(after.sheets[0].cells.find(c=>c.address==='D1').cachedValue.value,90);assert.equal(after.sheets[1].cells[0].cachedValue.value,90);
  assert.deepEqual(Buffer.from(await (await request(`assets/${sheet.assetId}/1/download`)).arrayBuffer()),original);
  assert.equal((await json(`assets/${sheet.assetId}/versions`)).data.versions.length,2);assert.equal((await json('jobs',post(edit,requestBody))).status,409);
 });
 await test('invalid plans and active formulas never publish a file',async()=>{
  assert.equal((await json('jobs',post({kind:'create_word',schemaVersion:1,fileName:'../x.docx',blocks:[]},req('docx')))).status,400);
  const plan={schemaVersion:1,kind:'create_workbook',fileName:'unsupported.xlsx',sheets:[{name:'Sheet',cells:[{address:'A1',value:{type:'formula',value:'=WEBSERVICE("https://example.com")'}}]}]};
  const failed=await done((await json('jobs',post(plan,req('xlsx')))).data);assert.equal(failed.status,'failed');assert.equal(failed.assetId,null);assert.equal(failed.canRecover,true);
 });
 await test('cancellation before POST arrival prevents late work',async()=>{
  const key=randomUUID(),count=(await json('assets')).data.assets.length;
  assert.equal((await json('jobs/'+key,{method:'DELETE'})).data.status,'cancelled');
  assert.equal((await json('jobs/'+key)).data.status,'cancelled');
  assert.equal((await json('jobs/'+key,{},2)).status,404);
  const plan={schemaVersion:1,kind:'create_word',fileName:'已取消.docx',blocks:[{type:'paragraph',text:'测试'}]};
  assert.equal((await json('jobs',post(plan,req('docx'),key))).status,409);
  assert.equal((await json('assets')).data.assets.length,count);
 });
 await test('concurrent work is bounded and cancellation does not publish',async()=>{
  const plan={schemaVersion:1,kind:'create_word',fileName:'并发.docx',blocks:[{type:'paragraph',text:'测试'}]};
  const pair=await Promise.all([json('jobs',post(plan,req('docx'))),json('jobs',post(plan,req('docx')))]);assert.deepEqual(pair.map(r=>r.status).sort(),[202,429]);
  const job=pair.find(r=>r.status===202).data;await json('jobs/'+job.id,{method:'DELETE'});const stopped=await done(job);assert.equal(stopped.status,'cancelled');assert.equal(stopped.assetId,null);
 });
 console.log(JSON.stringify({passed:results.length,tests:results}));
} finally {
 child.kill();await new Promise(resolve=>child.once('close',resolve));
 await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
