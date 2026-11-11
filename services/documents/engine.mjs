import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as numfmt from 'numfmt';
import { buildBlankDocx } from 'genoffice-source/packages/docx-engine/src/blank.ts';
import { parseDocx } from 'genoffice-source/packages/docx-engine/src/parse.ts';
import { saveDocx } from 'genoffice-source/packages/docx-engine/src/patch.ts';
import { decodeEntities } from 'genoffice-source/packages/docx-engine/src/parse-xml-text.ts';
import { generateTableXml, patchTableCellTexts } from 'genoffice-source/packages/docx-engine/src/generate.ts';
import { patchParagraphTexts } from 'genoffice-source/packages/docx-engine/src/text-patch.ts';
import { blankWorkbook, writeWorkbook, additionPlan } from 'genoffice-source/packages/cli/src/formats/xlsx.ts';
import { XlsxSidecarClient } from 'genoffice-source/apps/sheets/src/main/xlsx-sidecar-client.ts';
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate';
import { decodeXlsxEscapes } from '@genoffice/xlsx-gateway/gateway/xlsx-escapes';

const revision = GENOFFICE_REVISION;
const fail = (code) => { throw new Error(code); };
const arr = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const text = (v) => typeof v === 'object' && v !== null ? String(v['#text'] ?? '') : String(v ?? '');
const parser = new XMLParser({ignoreAttributes:false, removeNSPrefix:true, parseTagValue:false, parseAttributeValue:false, trimValues:false});
function xml(s) {
  if (/<!DOCTYPE|<!ENTITY/i.test(s) || XMLValidator.validate(s) !== true) fail('XML_UNSUPPORTED');
  return parser.parse(s);
}
const eq = (a,b) => a?.type === b?.type && (a.type === 'blank' || a.value === b.value);
const functions = new Set('SUM AVERAGE MIN MAX COUNT COUNTA IF AND OR NOT ROUND ROUNDUP ROUNDDOWN ABS SUMIF SUMIFS COUNTIF COUNTIFS IFERROR'.split(' '));
function formula(s) {
  if (typeof s !== 'string' || s.length > 2048 || !s.startsWith('=') || /[\[\]|]|:\/\//.test(s)) fail('FORMULA_UNSUPPORTED');
  const scan = s.replace(/"(?:[^"]|"")*"/g,'""');
  for(const m of scan.matchAll(/([A-Z_][A-Z_0-9.]*)\s*\(/gi)) if(!functions.has(m[1].toUpperCase())) fail('FORMULA_UNSUPPORTED');
}
async function packageOf(bytes,format) {
  if(bytes.length>20*1024*1024) fail('FILE_TOO_LARGE');
  await assertZipInflatesWithinLimits(bytes,{maxParts:10000,maxPartBytes:32*1024*1024,maxTotalBytes:100*1024*1024});
  const zip=await JSZip.loadAsync(bytes);
  if(!zip.file(format==='docx'?'word/document.xml':'xl/workbook.xml')) fail('FORMAT_MISMATCH');
  for(const [name,entry] of Object.entries(zip.files)) {
    if(entry.dir) continue;
    if(/vbaProject|embeddings\/|_xmlsignatures\/|externalLinks\/|connections\.xml|altChunk/i.test(name)) fail('ACTIVE_CONTENT_UNSUPPORTED');
    if(name.endsWith('.xml') || name.endsWith('.rels')) {
      const raw=await entry.async('string');
      const parsed=xml(raw);
      if(/<(?:\w+:)?(?:documentProtection|sheetProtection|workbookProtection|ins|del|moveFrom|moveTo)\b/.test(raw)) fail('PROTECTED_OR_REVISION_DOCUMENT_UNSUPPORTED');
      if(name.endsWith('.rels')) for(const rel of arr(parsed.Relationships?.Relationship)) {
        if(rel['@_TargetMode']?.toLowerCase()==='external' && !/^http:\/\/(schemas\.openxmlformats\.org\/officeDocument\/2006|purl\.oclc\.org\/ooxml\/officeDocument)\/relationships\/hyperlink$/.test(rel['@_Type']||'')) fail('EXTERNAL_RESOURCE_UNSUPPORTED');
      }
    }
  }
  return zip;
}
function wordIndex(parsed) {
  const paragraphs=[];
  for(const block of parsed.blocks) {
    if(block.hidden || block.docxIndex == null || !block.originalXml) continue;
    const nested=/<w:(?:txbxContent|sdt|drawing|pict)\b/.test(block.originalXml);
    for(const m of block.originalXml.matchAll(/<w:p(?=[\s/>])(?:\s[^>]*?)?\/>|<w:p(?=[\s>])[^>]*>[\s\S]*?<\/w:p>/g)) {
      const raw=m[0];
      const content=[...raw.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr|noBreakHyphen|softHyphen)\b[^>]*\/>/g)].map(t=>t[2]?({tab:'\t',br:'\n',cr:'\n',noBreakHyphen:'\u2011',softHyphen:'\u00ad'}[t[2]]):decodeEntities(t[1])).join('');
      const editable=!nested && !/<w:(?:tab|br|cr|noBreakHyphen|softHyphen|sym|ptab|ruby|fldChar|fldSimple|instrText|hyperlink|bookmarkStart|bookmarkEnd|commentRangeStart|footnoteReference|endnoteReference)\b/.test(raw);
      paragraphs.push({id:`paragraph-${paragraphs.length}`,text:content,editable:editable && /<w:t[\s>]/.test(raw),inTable:block.type==='table',style:block.styleId||'Normal',blockIndex:block.docxIndex,offset:m.index,raw});
    }
  }
  if(paragraphs.length>2000 || paragraphs.reduce((n,p)=>n+p.text.length,0)>500000) fail('DOCUMENT_CONTENT_TOO_LARGE');
  return paragraphs;
}
function wordSnapshot(parsed,index=wordIndex(parsed)) {
  return {format:'docx',paragraphs:index.map(({raw,offset,blockIndex,...p})=>p),features:{tables:parsed.blocks.filter(b=>b.type==='table').length},previewKind:'content'};
}
function patchWordRange(raw,start,length,replacement) {
  // Patch each original run separately: the upstream whole-paragraph helper
  // can move an untouched suffix into the first run and change its style.
  let offset=0,inserted=false;const patches=[];
  for(const m of raw.matchAll(/<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g)) {
    const value=[...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t=>decodeEntities(t[1])).join('');
    const end=offset+value.length;
    if(end>start&&offset<start+length) {
      const left=Math.max(0,start-offset),right=Math.min(value.length,start+length-offset);
      const next=value.slice(0,left)+(inserted?'':replacement)+value.slice(right);inserted=true;
      const patched=patchParagraphTexts('<w:p>'+m[0]+'</w:p>',next);
      if(patched===null)fail('PARAGRAPH_FEATURE_UNSUPPORTED');
      patches.push({offset:m.index,length:m[0].length,value:patched.slice(5,-6)});
    }
    offset=end;
  }
  if(!inserted)fail('PARAGRAPH_FEATURE_UNSUPPORTED');
  let output=raw;
  for(const p of patches.reverse())output=output.slice(0,p.offset)+p.value+output.slice(p.offset+p.length);
  return output;
}
async function word(req) {
  const source=req.inputPath?await readFile(req.inputPath):Buffer.from(await buildBlankDocx({eastAsiaFont:'Noto Sans CJK SC',application:'QXChat'}));
  await packageOf(source,'docx');
  const parsed=await parseDocx(source), index=wordIndex(parsed),changes=[];
  if(req.action==='inspect') return {structure:wordSnapshot(parsed,index),calculation:'not_required'};
  const plan=req.plan;
  let blocks, expected;
  if(plan?.kind==='create_word' && !req.inputPath) {
    if(!Array.isArray(plan.blocks)||!plan.blocks.length||plan.blocks.length>1000) fail('PLAN_INVALID');
    blocks=[];
    for(const b of plan.blocks) {
      if(b.type==='paragraph') {
        if(typeof b.text!=='string'||b.text.length>16000) fail('PLAN_INVALID');
        blocks.push({kind:'generated',block:{type:b.style==='bullet'?'listItem':/^heading[12]$/.test(b.style)?'heading':'paragraph',level:b.style==='heading1'?1:2,styleId:b.style==='title'?'Title':undefined,list:b.style==='bullet'?{kind:'bullet',numId:'1',ilvl:0}:undefined,runs:[{text:b.text}]}});
      } else if(b.type==='table') {
        if(!b.rows?.length||b.rows.length>50||b.rows.some(r=>r.length!==b.rows[0].length||r.length>20||r.length===0)) fail('TABLE_SIZE_UNSUPPORTED');
        const raw=generateTableXml(b.rows.length,b.rows[0].length,{headerRow:true});
        const filled=patchTableCellTexts(raw,b.rows.map(r=>r.map(c=>[c])));
        blocks.push({kind:'xml',xml:filled});
      } else fail('OPERATION_UNSUPPORTED');
    }
  } else if(plan?.kind==='edit' && req.inputPath) {
    expected=index.map(p=>p.text);
    const seen=new Set(),patches=new Map();
    for(const op of plan.operations||[]) {
      if(op.op!=='replace_text') fail('OPERATION_FORMAT_MISMATCH');
      const p=index.find(p=>p.id===op.paragraphId);
      if(!p||seen.has(p.id)) fail('TARGET_INVALID');
      seen.add(p.id);
      if(!p.editable||/[\r\n\t]/.test(op.text)) fail('PARAGRAPH_FEATURE_UNSUPPORTED');
      if(!Number.isInteger(op.start)||op.start<0||!op.expectedText||p.text.slice(op.start,op.start+op.expectedText.length)!==op.expectedText) fail('OLD_VALUE_MISMATCH');
      const after=p.text.slice(0,op.start)+op.text+p.text.slice(op.start+op.expectedText.length);
      const patched=patchWordRange(p.raw,op.start,op.expectedText.length,op.text);
      if(patched===null) fail('PARAGRAPH_FEATURE_UNSUPPORTED');
      expected[Number(p.id.slice(10))]=after;
      if(after===p.text) continue;
      const ps=patches.get(p.blockIndex)||[];ps.push({...p,patched});patches.set(p.blockIndex,ps);
      changes.push({op:op.op,paragraphId:p.id,before:p.text,after});
    }
    blocks=parsed.blocks.filter(b=>!b.hidden).map(b=>{
      if(!patches.has(b.docxIndex)) return {kind:'original',docxIndex:b.docxIndex};
      let raw=b.originalXml;
      for(const p of patches.get(b.docxIndex).sort((a,b)=>b.offset-a.offset)) raw=raw.slice(0,p.offset)+p.patched+raw.slice(p.offset+p.raw.length);
      return {kind:'xml',docxIndex:b.docxIndex,xml:raw};
    });
  } else fail('PLAN_SOURCE_MISMATCH');
  const output=Buffer.from(await saveDocx(parsed,blocks));
  await packageOf(output,'docx');
  const reopened=await parseDocx(output),after=wordIndex(reopened);
  if(expected && JSON.stringify(expected)!==JSON.stringify(after.map(p=>p.text))) fail('WORD_ROUNDTRIP_MISMATCH');
  await writeFile(req.outputPath,output,{flag:'wx'});
  return {structure:wordSnapshot(reopened,after),changes,calculation:'not_required'};
}
const richText=(n)=>decodeXlsxEscapes(n?.t!=null?text(n.t):arr(n?.r).map(r=>text(r.t)).join(''));
const column=(s)=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
function address(s) {const m=/^([A-Z]{1,3})([1-9][0-9]{0,5})$/.exec(s);if(!m||column(m[1])>16384||+m[2]>100000)fail('TARGET_INVALID');return {row:+m[2]-1,column:column(m[1])-1};}
function serial(v) {if(v.type==='datetime'&&!/\.\d{3}0000$/.test(v.value))fail('DATETIME_PRECISION_UNSUPPORTED');const n=(Date.parse(v.value.length===10?v.value+'T00:00:00Z':v.value.slice(0,23)+'Z')-Date.UTC(1899,11,30))/86400000;if(!Number.isFinite(n))fail('DATE_INVALID');if(n<61||n>=2958465)fail('DATE_RANGE_UNSUPPORTED');return n;}
function typed(v,fmt) {
  if(v===null||v===undefined) return {type:'blank'};
  if(typeof v==='boolean') return {type:'boolean',value:v};
  if(typeof v==='number') {
    if(fmt && numfmt.isDateFormat(fmt)) {
      if(v<61||v>=2958465)fail('DATE_RANGE_UNSUPPORTED');
      if(Math.abs(v*86400000-Math.round(v*86400000))>0.01)fail('DATETIME_PRECISION_UNSUPPORTED');
      const iso=new Date(Date.UTC(1899,11,30)+Math.round(v*86400000)).toISOString();
      return iso.slice(11,23)==='00:00:00.000'&&!/[hs]/i.test(fmt.replace(/"[^"]*"/g,''))?{type:'date',value:iso.slice(0,10)}:{type:'datetime',value:iso.slice(0,23)+'0000'};
    }
    return {type:'number',value:v};
  }
  return {type:'text',value:String(v)};
}
async function sheetSnapshot(bytes) {
  const zip=await packageOf(bytes,'xlsx'),read=async name=>xml(await zip.file(name).async('string'));
  const wb=(await read('xl/workbook.xml')).workbook;
  if(['1','true'].includes(wb.workbookPr?.['@_date1904'])) fail('DATE_SYSTEM_UNSUPPORTED');
  if(arr(wb.definedNames?.definedName).some(n=>!/^_xlnm\.(Print_Area|Print_Titles)$/.test(n['@_name']||''))) fail('NAMED_FORMULA_UNSUPPORTED');
  const sheets=arr(wb.sheets?.sheet);if(!sheets.length||sheets.length>20) fail('TOO_MANY_SHEETS');
  const rels=arr((await read('xl/_rels/workbook.xml.rels')).Relationships.Relationship);
  const strings=zip.file('xl/sharedStrings.xml')?arr((await read('xl/sharedStrings.xml')).sst?.si).map(richText):[];
  const styles=zip.file('xl/styles.xml')?(await read('xl/styles.xml')).styleSheet:{};
  const fmts=new Map(arr(styles.numFmts?.numFmt).map(f=>[+f['@_numFmtId'],f['@_formatCode']]));
  const xfs=arr(styles.cellXfs?.xf);
  const builtins={0:'General',1:'0',2:'0.00',9:'0%',10:'0.00%',14:'yyyy-mm-dd',15:'d-mmm-yy',16:'d-mmm',17:'mmm-yy',18:'h:mm AM/PM',19:'h:mm:ss AM/PM',20:'h:mm',21:'h:mm:ss',22:'yyyy-mm-dd hh:mm',49:'@'};
  let count=0;const out=[];
  for(const s of sheets) {
    const rel=rels.find(r=>r['@_Id']===s['@_id']);if(!rel)fail('SHEET_RELATIONSHIP_INVALID');
    const target=rel['@_Target'].startsWith('/')?rel['@_Target'].slice(1):path.posix.normalize('xl/'+rel['@_Target']);
    if(!target.startsWith('xl/')||!zip.file(target))fail('SHEET_RELATIONSHIP_INVALID');
    const sheet=(await read(target)).worksheet,cells=[];
    for(const row of arr(sheet.sheetData?.row)) for(const c of arr(row.c)) {
      if(++count>10000)fail('TOO_MANY_CELLS');
      address(c['@_r']);
      const formatId=+xfs[+c['@_s']||0]?.['@_numFmtId']||0,numberFormat=fmts.get(formatId)||builtins[formatId]||'General';
      let raw=c.v==null?null:text(c.v),value;
      if(c['@_t']==='e') fail('FORMULA_ERROR');
      if(c['@_t']==='s') {if(raw===null||strings[+raw]===undefined)fail('SHARED_STRING_INVALID');value=strings[+raw];}
      else if(c['@_t']==='inlineStr') value=richText(c.is);
      else if(c['@_t']==='str') value=decodeXlsxEscapes(raw??'');
      else if(c['@_t']==='b') value=raw==='1';
      // ISO-date cells are uncommon and the sidecar's roundtrip semantics
      // differ from serial dates. Reject before JS can apply the host time
      // zone or silently truncate submillisecond precision.
      else if(c['@_t']==='d') fail('ISO_DATE_CELL_UNSUPPORTED');
      else {value=raw===null?null:Number(raw);if(value!==null&&!Number.isFinite(value))fail('CELL_VALUE_INVALID');}
      const f=c.f==null?null:'='+text(c.f);
      if(f){if(typeof c.f==='object'&&c.f['@_t'])fail('COMPLEX_FORMULA_UNSUPPORTED');formula(f);}
      const cellValue=f?{type:'formula',value:f}:typed(value,numberFormat);
      let display=value==null?'':String(value);try{if(typeof value==='number')display=numfmt.format(numberFormat,value);}catch{}
      cells.push({address:c['@_r'],value:cellValue,cachedValue:f?typed(value):null,rawNumber:typeof value==='number'?value:null,numberFormat,display});
    }
    if(new Set(cells.map(c=>c.address)).size!==cells.length)fail('DUPLICATE_CELL_ADDRESS');
    out.push({id:`sheet-${out.length}`,name:s['@_name'],hidden:s['@_state']==='hidden'||s['@_state']==='veryHidden',cells,mergedRanges:arr(sheet.mergeCells?.mergeCell).map(c=>c['@_ref']),blankCells:'可在有效地址填写；保存前核对原值'});
  }
  return {format:'xlsx',sheets:out,previewKind:'content'};
}
async function auditFormulas(file,snapshot) {
  const formulas=snapshot.sheets.flatMap(s=>s.cells.filter(c=>c.value.type==='formula').map(c=>({sheet:s.name,cell:c,...address(c.address)})));
  if(!formulas.length)return 'not_required';
  const client=new XlsxSidecarClient(process.env.XLSX_SIDECAR_PATH);
  try {
    const result=await client.recalcCells({path:file,edits:[],reads:formulas.map(f=>({sheet:f.sheet,range:{startRow:f.row,endRow:f.row,startColumn:f.column,endColumn:f.column}})),reportStale:true});
    if(result.auditSkipped||!Array.isArray(result.stale)||result.stale.length||result.staleSpillCells?.length||result.staleUnrefreshed?.length)fail('FORMULA_CACHE_UNVERIFIED');
    for(const f of formulas) {
      const r=result.cells.find(r=>r.sheet===f.sheet&&r.row===f.row&&r.column===f.column);
      if(!r||r.isError||!r.isFormula)fail('FORMULA_ERROR');
      const actual=typed(r.boolean??r.number??r.formatted),saved=f.cell.cachedValue;
      if(actual.type==='number'&&saved?.type==='number') {if(Math.abs(actual.value-saved.value)>1e-10*Math.max(1,Math.abs(actual.value)))fail('FORMULA_CACHE_MISMATCH');}
      else if(!eq(actual,saved))fail('FORMULA_CACHE_MISMATCH');
    }
    return 'verified';
  }finally{client.stop();}
}
function inputCell(sheet,c) {
  address(c.address);const v=c.value,style={...c.style};
  if(v.type==='formula'){formula(v.value);return {sheet,cell:c.address,formula:v.value,style};}
  if(['date','datetime'].includes(v.type)) return {sheet,cell:c.address,value:serial(v),style:{...style,numberFormat:v.type==='date'?'yyyy-mm-dd':'yyyy-mm-dd hh:mm:ss'}};
  return {sheet,cell:c.address,value:v.type==='blank'?null:v.value,style};
}
async function excel(req) {
  const plan=req.plan,changes=[];
  let source,before,edits=[],options={};
  if(req.inputPath) {source=await readFile(req.inputPath);before=await sheetSnapshot(source);}
  if(req.action==='inspect')return {structure:before,calculation:await auditFormulas(req.inputPath,before)};
  if(plan?.kind==='create_workbook'&&!req.inputPath){
    if(!plan.sheets?.length||plan.sheets.length>20)fail('PLAN_INVALID');
    source=await blankWorkbook(plan.sheets[0].name);
    options.plan=additionPlan(plan.sheets[0].name,plan.sheets.slice(1).map(s=>s.name));
    const seen=new Set();
    for(const s of plan.sheets)for(const c of s.cells){const k=s.name+'!'+c.address;if(seen.has(k))fail('TARGET_INVALID');seen.add(k);edits.push(inputCell(s.name,c));}
  }else if(plan?.kind==='edit'&&before){
    const seen=new Set();
    for(const op of plan.operations||[]) {
      if(op.op!=='set_cell')fail('OPERATION_FORMAT_MISMATCH');
      const s=before.sheets.find(s=>s.id===op.sheetId),key=op.sheetId+'!'+op.address;
      if(!s||seen.has(key))fail('TARGET_INVALID');seen.add(key);const at=address(op.address);
      for(const merge of s.mergedRanges){const [a,b=a]=merge.split(':');const first=address(a),last=address(b);if(at.row>=first.row&&at.row<=last.row&&at.column>=first.column&&at.column<=last.column&&op.address!==a)fail('MERGED_CELL_TARGET_UNSUPPORTED');}
      const old=s.cells.find(c=>c.address===op.address)?.value||{type:'blank'};
      if(!eq(old,op.expectedOldValue))fail('OLD_VALUE_MISMATCH');
      if(eq(old,op.value))continue;
      edits.push(inputCell(s.name,op));changes.push({op:op.op,sheetId:s.id,address:op.address,before:old,after:op.value});
    }
  }else fail('PLAN_SOURCE_MISMATCH');
  if(edits.length>10000)fail('TOO_MANY_CELLS');
  // The CLI convenience parser interprets every string beginning '=' as a formula.
  // The site's explicit value type must survive unchanged at this boundary.
  const typedEdits=edits.map(e=>({sheetName:e.sheet,...address(e.cell),writeValue:true,cell:e.formula?{value:null,formula:e.formula}:{value:e.value},style:e.style}));
  const outcome=await writeWorkbook(source,typedEdits,req.outputPath,options);
  if(!outcome.cachedValues||outcome.warning||outcome.formulaError||outcome.dependentsWarning||outcome.uncached?.length||outcome.unparsed?.length)fail('FORMULA_CACHE_UNVERIFIED');
  const after=await sheetSnapshot(await readFile(req.outputPath));
  for(const e of edits){const c=after.sheets.find(s=>s.name===e.sheet)?.cells.find(c=>c.address===e.cell);const want=e.formula?{type:'formula',value:e.formula}:typed(e.value,e.style?.numberFormat);if(!eq(c?.value||{type:'blank'},want))fail('CELL_ROUNDTRIP_MISMATCH');}
  if(before)for(const s of before.sheets)for(const c of s.cells){
    if(edits.some(e=>e.sheet===s.name&&e.cell===c.address))continue;
    const now=after.sheets.find(n=>n.name===s.name)?.cells.find(n=>n.address===c.address);
    if(!eq(now?.value||{type:'blank'},c.value))fail('UNTOUCHED_CELL_CHANGED');
  }
  return {structure:after,changes,calculation:await auditFormulas(req.outputPath,after)};
}
async function main() {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='health') {
    console.log(JSON.stringify({engine:'genoffice',version:revision,words:true,cells:!!process.env.XLSX_SIDECAR_PATH&&existsSync(process.env.XLSX_SIDECAR_PATH),license:'Apache-2.0',evaluation:false,preview:'content'}));return;
  }
  if(args.length!==2)fail('ENGINE_ARGUMENTS');
  if((await stat(args[0])).size>1024*1024)fail('PLAN_TOO_LARGE');
  const req=JSON.parse(await readFile(args[0],'utf8'));
  if(!['docx','xlsx'].includes(req.format)||!['inspect','execute'].includes(req.action))fail('FORMAT_UNSUPPORTED');
  if(req.action==='execute'&&(req.plan?.schemaVersion!==1||!path.isAbsolute(req.outputPath)))fail('PLAN_INVALID');
  if(req.inputPath && path.resolve(req.inputPath)===path.resolve(req.outputPath))fail('SOURCE_OVERWRITE_FORBIDDEN');
  const result=await (req.format==='docx'?word(req):excel(req));
  await writeFile(args[1],JSON.stringify({...result,file:'valid',evaluation:false,preview:'content',engine:'genoffice',engineVersion:revision}),{flag:'wx'});
  console.log('{"ok":true}');
}
main().catch(e=>{console.log(JSON.stringify({ok:false,code:/^[A-Z_]+$/.test(e.message)?e.message:'DOCUMENT_ENGINE_FAILED'}));if(process.env.DOCUMENT_ENGINE_DEBUG==='1')console.error(e);process.exitCode=1;});
