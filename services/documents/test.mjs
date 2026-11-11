import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';
const here=path.dirname(fileURLToPath(import.meta.url));
const dir=path.resolve(process.env.DOCUMENT_TEST_OUTPUT||path.join(here,'test-output',randomUUID()));
await mkdir(dir,{recursive:true});
const results=[];
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL '+name+': '+e.stack);}}
async function run(name,format,plan,inputPath='',error){
  const req={action:plan?'execute':'inspect',format,plan,inputPath,outputPath:path.join(dir,name+'.'+format),previewPath:''};
  const request=path.join(dir,name+'.request.json'),response=path.join(dir,name+'.response.json');await writeFile(request,JSON.stringify(req));
  const p=spawnSync(process.execPath,[path.join(here,'dist/engine.cjs'),request,response],{encoding:'utf8',timeout:200000,windowsHide:true,env:{...process.env,DOCUMENT_ENGINE_DEBUG:'1'}});
  if(error){assert.notEqual(p.status,0);if(typeof error==='string')assert.equal(JSON.parse(p.stdout.trim()).code,error);else assert.match(JSON.parse(p.stdout.trim()).code,/^FORMULA_(CACHE_UNVERIFIED|ERROR)$/);return;}
  assert.equal(p.status,0,p.stdout+' '+p.stderr);
  return {...JSON.parse(await readFile(response,'utf8')),path:req.outputPath};
}
const txt=v=>({type:'text',value:v}),num=v=>({type:'number',value:v}),fx=v=>({type:'formula',value:v});
const edit=operations=>({schemaVersion:1,kind:'edit',sourceArtifactId:randomUUID(),baseVersion:1,operations});
let word,sheet;
await check('Word: Chinese title/body/table and no evaluation watermark',async()=>{
 word=await run('word','docx',{schemaVersion:1,kind:'create_word',fileName:'合同.docx',blocks:[{type:'paragraph',style:'title',text:'合作合同'},{type:'paragraph',text:'付款期限为30天。'},{type:'paragraph',text:'付款期限为30天。'},{type:'table',rows:[['项目','金额'],['服务费','1000']]}]});
 assert.equal(word.file,'valid');assert(word.structure.paragraphs.some(p=>p.text==='服务费'));
 const z=await JSZip.loadAsync(await readFile(word.path));assert(!/Evaluation|Aspose|watermark/i.test(await z.file('word/document.xml').async('string')));
});
await check('Word: one repeated sentence changes; table and source preserved',async()=>{
 const original=await readFile(word.path),hash=createHash('sha256').update(original).digest('hex');
 const p=word.structure.paragraphs.find(p=>p.text==='付款期限为30天。');
 const changed=await run('word-edit','docx',edit([{op:'replace_text',paragraphId:p.id,start:5,expectedText:'30',text:'45'}]),word.path);
 assert.equal(changed.structure.paragraphs.filter(p=>p.text==='付款期限为45天。').length,1);assert.equal(changed.structure.paragraphs.filter(p=>p.text==='付款期限为30天。').length,1);
 const cell=changed.structure.paragraphs.find(p=>p.text==='1000');
 const table=await run('word-table-edit','docx',edit([{op:'replace_text',paragraphId:cell.id,start:0,expectedText:'1000',text:'2000'}]),changed.path);assert(table.structure.paragraphs.some(p=>p.text==='2000'));
 assert.equal(createHash('sha256').update(await readFile(word.path)).digest('hex'),hash);
});
await check('Word: wrong old text rejected',async()=>{const p=word.structure.paragraphs[1];await run('word-wrong','docx',edit([{op:'replace_text',paragraphId:p.id,start:0,expectedText:'错误',text:'替换'}]),word.path,'OLD_VALUE_MISMATCH');});
await check('Word: oversize table is rejected, never silently truncated',async()=>{await run('word-large','docx',{schemaVersion:1,kind:'create_word',blocks:[{type:'table',rows:Array.from({length:51},()=>['x'])}]},'','TABLE_SIZE_UNSUPPORTED');});
await check('Excel: types, literal equals, formula cache and cross-sheet totals',async()=>{
 sheet=await run('sales','xlsx',{schemaVersion:1,kind:'create_workbook',fileName:'销售.xlsx',sheets:[{name:'明细',cells:[{address:'A1',value:txt('编号')},{address:'A2',value:txt('00123')},{address:'B2',value:num(2)},{address:'C2',value:num(30)},{address:'D2',value:fx('=B2*C2')},{address:'E2',value:txt('=SUM(1,2)')},{address:'F2',value:{type:'boolean',value:true}},{address:'G2',value:{type:'date',value:'2026-11-03'}},{address:'H2',value:{type:'datetime',value:'2026-11-03T12:30:10.0000000'}}]},{name:'汇总',cells:[{address:'A1',value:fx("=SUM('明细'!D2)")},{address:'A2',value:fx('=ROUND(A1*1.13,2)')},{address:'A3',value:fx('=A1>30')}]}]});
 assert.equal(sheet.calculation,'verified');const s=sheet.structure.sheets[0];assert.deepEqual(s.cells.find(c=>c.address==='A2').value,txt('00123'));assert.deepEqual(s.cells.find(c=>c.address==='E2').value,txt('=SUM(1,2)'));assert.equal(s.cells.find(c=>c.address==='D2').cachedValue.value,60);assert.equal(sheet.structure.sheets[1].cells.find(c=>c.address==='A2').cachedValue.value,67.8);assert.equal(sheet.structure.sheets[1].cells.find(c=>c.address==='A3').cachedValue.value,true);assert.equal(s.cells.find(c=>c.address==='H2').value.value,'2026-11-03T12:30:10.0000000');
});
await check('Excel: editing price recalculates all dependent saved caches',async()=>{
 const original=await readFile(sheet.path);
 const changed=await run('sales-edit','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C2',expectedOldValue:num(30),value:num(35.5)}]),sheet.path);
 assert.equal(changed.structure.sheets[0].cells.find(c=>c.address==='D2').cachedValue.value,71);assert.equal(changed.structure.sheets[1].cells.find(c=>c.address==='A2').cachedValue.value,80.23);assert.deepEqual(await readFile(sheet.path),original);
});
await check('Excel: wrong address/old value rejected',async()=>{await run('wrong-cell','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C3',expectedOldValue:num(30),value:num(35)}]),sheet.path,'OLD_VALUE_MISMATCH');});
await check('Excel: blank cell fill and text style preserved',async()=>{const r=await run('blank','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C3',expectedOldValue:{type:'blank'},value:txt('00045')}]),sheet.path);assert.deepEqual(r.structure.sheets[0].cells.find(c=>c.address==='C3').value,txt('00045'));});
await check('Excel: unsupported formula rejected',async()=>{await run('bad-formula','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C3',expectedOldValue:{type:'blank'},value:fx('=WEBSERVICE("http://localhost/")')}]),sheet.path,'FORMULA_UNSUPPORTED');});
await check('Excel: circular formula cannot report success',async()=>{await run('circular','xlsx',{schemaVersion:1,kind:'create_workbook',sheets:[{name:'Sheet',cells:[{address:'A1',value:fx('=A1+1')}]}]},'',true);});
await check('Excel: division error cannot report success',async()=>{await run('divzero','xlsx',{schemaVersion:1,kind:'create_workbook',sheets:[{name:'Sheet',cells:[{address:'A1',value:fx('=1/0')}]}]},'',true);});
await check('Package: external image alongside hyperlink rejected',async()=>{
 const z=await JSZip.loadAsync(await readFile(word.path));const name='word/_rels/document.xml.rels';const s=await z.file(name).async('string');z.file(name,s.replace('</Relationships>','<Relationship Id="rId33" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/><Relationship Id="rId34" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://localhost/secret" TargetMode="External"/></Relationships>'));const file=path.join(dir,'external.docx');await writeFile(file,await z.generateAsync({type:'nodebuffer'}));await run('external-check','docx',null,file,'EXTERNAL_RESOURCE_UNSUPPORTED');
});
await check('Excel: import rejects tampered stale caches',async()=>{
 const z=await JSZip.loadAsync(await readFile(sheet.path));const name='xl/worksheets/sheet1.xml';const s=await z.file(name).async('string');assert(s.includes('<v>60</v>'));z.file(name,s.replace('<v>60</v>','<v>999</v>'));const file=path.join(dir,'stale.xlsx');await writeFile(file,await z.generateAsync({type:'nodebuffer'}));await run('stale-check','xlsx',null,file,'FORMULA_CACHE_UNVERIFIED');
});
await check('Excel: literal XLSX escape sequence survives unchanged',async()=>{
 const r=await run('literal-escape','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C3',expectedOldValue:{type:'blank'},value:txt('_x0041_')}]),sheet.path);
 assert.deepEqual(r.structure.sheets[0].cells.find(c=>c.address==='C3').value,txt('_x0041_'));
});
await check('Word: cross-run change preserves untouched suffix formatting',async()=>{
 const z=await JSZip.loadAsync(await readFile(word.path));const n='word/document.xml';const raw=await z.file(n).async('string');
 z.file(n,raw.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/,'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>AB</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>CD</w:t></w:r></w:p>'));
 const file=path.join(dir,'runs.docx');await writeFile(file,await z.generateAsync({type:'nodebuffer'}));
 const r=await run('runs-edit','docx',edit([{op:'replace_text',paragraphId:'paragraph-0',start:1,expectedText:'BC',text:'X'}]),file);
 assert.equal(r.structure.paragraphs[0].text,'AXD');const out=await JSZip.loadAsync(await readFile(r.path));assert.match(await out.file(n).async('string'),/<w:r><w:rPr><w:i\/><\/w:rPr><w:t(?: [^>]*)?>D<\/w:t><\/w:r>/);
});
await check('Word: nonbreaking hyphen is shown and protected',async()=>{
 const z=await JSZip.loadAsync(await readFile(word.path));const n='word/document.xml';z.file(n,(await z.file(n).async('string')).replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/,'<w:p><w:r><w:t>A</w:t><w:noBreakHyphen/><w:t>B</w:t></w:r></w:p>'));const file=path.join(dir,'hyphen.docx');await writeFile(file,await z.generateAsync({type:'nodebuffer'}));const inspected=await run('hyphen-read','docx',null,file);assert.equal(inspected.structure.paragraphs[0].text,'A\u2011B');assert.equal(inspected.structure.paragraphs[0].editable,false);
 await run('hyphen-write','docx',edit([{op:'replace_text',paragraphId:'paragraph-0',start:0,expectedText:'AB',text:'CD'}]),file,'PARAGRAPH_FEATURE_UNSUPPORTED');
});
await check('Excel: midnight datetime retains its type',async()=>{
 const r=await run('midnight','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C3',expectedOldValue:{type:'blank'},value:{type:'datetime',value:'2026-11-03T00:00:00.0000000'}}]),sheet.path);
 assert.equal(r.structure.sheets[0].cells.find(c=>c.address==='C3').value.type,'datetime');
});
await check('Excel: unsupported submillisecond datetime rejected',async()=>{
 await run('submillisecond','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C3',expectedOldValue:{type:'blank'},value:{type:'datetime',value:'2026-11-03T12:30:10.1234567'}}]),sheet.path,'DATETIME_PRECISION_UNSUPPORTED');
});
await check('Excel: early date rejected instead of changed to a number',async()=>{
 await run('early-date','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'C3',expectedOldValue:{type:'blank'},value:{type:'date',value:'1900-01-01'}}]),sheet.path,'DATE_RANGE_UNSUPPORTED');
});
await check('Excel: hidden merged-cell write is rejected',async()=>{
 const z=await JSZip.loadAsync(await readFile(sheet.path));const n='xl/worksheets/sheet1.xml';z.file(n,(await z.file(n).async('string')).replace('</worksheet>','<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>'));const file=path.join(dir,'merged.xlsx');await writeFile(file,await z.generateAsync({type:'nodebuffer'}));
 await run('merge-write','xlsx',edit([{op:'set_cell',sheetId:'sheet-0',address:'B1',expectedOldValue:{type:'blank'},value:txt('hidden')}]),file,'MERGED_CELL_TARGET_UNSUPPORTED');
});
await check('Excel: ISO-date import never shifts timezone or truncates precision',async()=>{
 for(const [name,date] of [['local','2026-11-03T12:30:10.000'],['precise','2026-11-03T12:30:10.1234567Z']]) {
  const z=await JSZip.loadAsync(await readFile(sheet.path));const n='xl/worksheets/sheet1.xml';
  z.file(n,(await z.file(n).async('string')).replace(/<c\b[^>]*\br="G2"[^>]*>[\s\S]*?<\/c>/,`<c r="G2" t="d"><v>${date}</v></c>`));
  const file=path.join(dir,`iso-date-${name}.xlsx`);await writeFile(file,await z.generateAsync({type:'nodebuffer'}));
  await run(`iso-date-${name}-check`,'xlsx',null,file,'ISO_DATE_CELL_UNSUPPORTED');
 }
});
await writeFile(path.join(dir,'results.json'),JSON.stringify({engine:'genoffice',timestamp:new Date().toISOString(),passed:results.filter(r=>r.passed).length,total:results.length,results},null,2));
console.log('RESULTS '+path.join(dir,'results.json'));
if(results.some(r=>!r.passed))process.exitCode=1;
