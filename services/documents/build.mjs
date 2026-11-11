import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFile, mkdir, copyFile, writeFile, readdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url));
const upstream = resolve(process.env.GENOFFICE_SOURCE || join(here, 'vendor'));
const require = createRequire(import.meta.url);
const lock = JSON.parse(await readFile(join(here, 'upstream-lock.json'), 'utf8'));
if (execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {encoding:'utf8', windowsHide:true}).trim() !== lock.commit)
  throw new Error('GENOFFICE_SOURCE_REVISION_MISMATCH');
const result = await build({
  absWorkingDir: here, entryPoints:['engine.mjs'], outfile:'dist/engine.cjs',
  platform:'node', target:'node24', format:'cjs', bundle:true, metafile:true,
  define:{ GENOFFICE_REVISION: JSON.stringify(lock.commit), 'import.meta.url':'__filename' },
  plugins:[{name:'locked-genoffice',setup(b){
    b.onResolve({filter:/^@genoffice\//},async ({path})=>{
      const [,name,...rest] = path.split('/');
      const root=join(upstream,'packages',name);
      const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
      const key=rest.length?'./'+rest.join('/'):'.';
      let target=pkg.exports?.[key];
      if(!target) for(const [k,v] of Object.entries(pkg.exports||{})) {
        if(k.includes('*') && key.startsWith(k.split('*')[0])) {
          target=v.replace('*',key.slice(k.indexOf('*')));break;
        }
      }
      if(typeof target!=='string') throw new Error('UNRESOLVED_PACKAGE_EXPORT:'+path);
      return {path:resolve(root,target)};
    });
    b.onResolve({filter:/^genoffice-source\//},({path})=>({path:join(upstream,path.slice('genoffice-source/'.length))}));
    b.onResolve({filter:/^(jszip|fast-xml-parser|utif2|numfmt|zod|undici)(\/.*)?$/},({path})=>({path:require.resolve(path)}));
  }}]
});
const inputs=Object.keys(result.metafile.inputs);
if(inputs.some(p=>/(^|[/\\])ee[/\\]/.test(p))) throw new Error('ENTERPRISE_CODE_FORBIDDEN');
await mkdir(join(here,'dist/licenses'),{recursive:true});
await copyFile(join(upstream,'LICENSE'),join(here,'dist/licenses/GenOffice-LICENSE.txt'));
await copyFile(join(upstream,'NOTICE'),join(here,'dist/licenses/GenOffice-NOTICE.txt'));
const included=Object.values(result.metafile.outputs).flatMap(o=>Object.entries(o.inputs).filter(([,v])=>v.bytesInOutput>0).map(([p])=>p));
const dependencies=new Map();
for(const input of included.filter(p=>p.includes('node_modules/'))) {
  let dir=dirname(resolve(here,input));
  for(let i=0;i<12;i++) {
    try {
      const pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
      if(pkg.name && pkg.license) {dependencies.set(pkg.name,{dir,name:pkg.name,version:pkg.version,license:pkg.license});break;}
    } catch {}
    const parent=dirname(dir);if(parent===dir)break;dir=parent;
  }
}
const notices=[];
for(const dep of dependencies.values()) {
  const dest=join(here,'dist/licenses/npm',dep.name.replace('/','__'));
  await mkdir(dest,{recursive:true});
  const names=await readdir(dep.dir);
  const files=names.filter(n=>/^(license|licence|copying|notice)(\.|$)/i.test(n));
  // Some published packages (e.g. isarray 1.0.0) put the complete MIT
  // license in their README. Preserve that original file, not a generated
  // substitute, and still fail closed if only a license name/link is given.
  if(!files.length && dep.license==='MIT') {
    for(const n of names.filter(n=>/^readme(\.|$)/i.test(n))) {
      const body=await readFile(join(dep.dir,n),'utf8');
      if(/copyright\s+\(c\)/i.test(body) &&
          /Permission is hereby granted, free of charge/i.test(body) &&
          /THE SOFTWARE IS PROVIDED ["“]AS IS/i.test(body) &&
          /OTHER DEALINGS IN THE\s+SOFTWARE/i.test(body)) {
        files.push(n);break;
      }
    }
  }
  if(!files.length)throw new Error('DEPENDENCY_LICENSE_TEXT_MISSING:'+dep.name);
  for(const n of files)await copyFile(join(dep.dir,n),join(dest,n));
  notices.push({name:dep.name,version:dep.version,license:dep.license});
}
// Include the original modified-source notices and corresponding source for
// the small vendored packages, including MPL-2.0 mtx, even if tree-shaken.
for(const vendor of ['packages/docx-engine/src/vendor/emf-converter','packages/pptx-engine/src/vendor/mtx']) {
  await cp(join(upstream,vendor),join(here,'dist/licenses/vendor',vendor.split('/').at(-1)),{recursive:true});
}
await writeFile(join(here,'dist/licenses/THIRD-PARTY-NOTICES.json'),JSON.stringify(notices,null,2));
await writeFile(join(here,'dist/build-manifest.json'),JSON.stringify({upstream:lock,inputs,included,dependencies:notices},null,2));
console.log('GenOffice core adapter built; '+inputs.length+' source modules; no enterprise code.');
