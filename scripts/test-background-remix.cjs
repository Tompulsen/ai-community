// SPDX-License-Identifier: AGPL-3.0-only
// Runs real Vue components and the local studio, with model/account APIs intercepted.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), frontend = createRequire(path.join(root, 'packages/frontend/package.json'));
const { parse, compileScript, compileStyleAsync } = frontend('vue/compiler-sfc');
const { chromium } = frontend('playwright'), esbuild = require('esbuild');
const origin = process.env.BACKGROUND_TEST_ORIGIN || 'https://background.test', studioUrl = process.env.STUDIO_TEST_URL || 'http://127.0.0.1:13411';
const output = process.env.BACKGROUND_TEST_OUTPUT || path.join(root, '.background-validation');
const src = path.join(root, 'packages/frontend/src');
const actual = new Set(['components/MkBackgroundStudio.vue', 'components/MkCommunityStudio.vue', 'components/MkStudioRemix.vue', 'components/MkModalWindow.vue', 'components/MkButton.vue', 'pages/creation.vue', 'pages/community/work-detail.vue', 'utility/background-studio.ts', 'utility/studio-remix.ts', 'utility/studio-copy.ts', 'utility/creation-pages.ts']);

async function buildFixture() {
  const compiled = new Map(); let css = '';
  for (const rel of actual) {
    if (!rel.endsWith('.vue')) continue;
    const filename = path.join(src, rel), { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename }), id = 'fixture-' + rel.replace(/\W/g, '-');
    const script = compileScript(descriptor, { id, inlineTemplate: true }), modules = {};
    for (const style of descriptor.styles) {
      const result = await compileStyleAsync({ source: style.content, filename, id, modules: true, preprocessLang: style.lang, preprocessCustomRequire: name => frontend(name === 'sass' ? 'sass-embedded' : name) });
      assert.deepEqual(result.errors, []); css += result.code; Object.assign(modules, result.modules);
    }
    compiled.set(filename, script.content.replace('export default ', 'const component=') + '\ncomponent.__cssModules={$style:' + JSON.stringify(modules) + '};export default component;');
  }
  const runtime = `import {ref,defineComponent,h,createApp} from 'vue';
export const homeLanguage='zh-CN',lang='zh-CN',deviceKind=innerWidth<500?'smartphone':'desktop',url=location.origin;
export const i18n={ts:{done:'完成',retry:'重试',notFound:'未找到'}};
export const $i={id:'fixtureUser',username:'fixture',token:'local-fixture',policies:{maxFileSizeMb:32}};
export const instance={clientOptions:{creationTextModel:'gpt-6.1-sol',creationImageModel:'gpt-image-2.6',creationVideoModel:'sora-2'}},fetchInstance=async()=>{},definePage=()=>{};
export const homeText={login:'登录',loginTitle:'登录后创作',loginHint:'请先登录',browse:'浏览社区',back:'返回'};
export const newApiSigninConfig=async()=>({enabled:true,studioOrigin:location.origin,studioPath:'/studio'});
export const useRouter=()=>window.__router,studioPath=kind=>'/create/'+(kind==='resource'?'text':kind),workText={back:'返回社区',preview:'作品',prompt:'提示词',remix:'做同款',retry:'重试',loading:'加载中',copied:'已复制',expandDetails:'展开详情',collapseDetails:'收起详情'};
export const safeWebUrl=v=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:undefined}catch{return undefined}};
export const newApiStudioLaunch=async()=>({origin:location.origin,subject:'9001',userId:$i.id,code:'b'.repeat(43)}),startNewApiLink=async()=>'',studioContext=()=>'a'.repeat(43),studioContextAction=async()=>{};
export const studioShareText={},createBrowserCommunityGateway=()=>({}),useStudioShare=()=>({phase:ref('idle'),progress:ref(0),notice:ref(''),draft:ref(),stop(){},receive(){},cancel(){},assertCurrent(){}});
export const misskeyApi=async()=>window.__work,communityUpdates=ref(0),getCommunityUpdateVersion=()=>0,getCommunityWorkReturnPath=()=>'/community',useWorkView=()=>ref(1);
export const toast=text=>{window.__notices.push(text)},alert=async()=>{};
export async function popupAsyncWithDialog(loader,props,events){const module=await loader,node=document.createElement('div');document.body.append(node);const app=createApp(module.default,{...props,...Object.fromEntries(Object.entries(events).map(([name,fn])=>['on'+name[0].toUpperCase()+name.slice(1),fn]))});app.mount(node);return{dispose(){app.unmount();node.remove()}}}
export const Stub=defineComponent({setup:()=>()=>h('div')}),Button=defineComponent({setup:(_,{slots,attrs})=>()=>h('button',{type:'button',...attrs},slots.default?.())});
export const Header=defineComponent({setup:(_,{slots})=>()=>h('section',{class:'page-shell'},slots.default?.())});
export const ModalShell=defineComponent({emits:['closed','esc'],setup:(_,{slots,expose,emit})=>{const open=ref(true);expose({close(){open.value=false;emit('closed')}});return()=>open.value?h('div',{role:'dialog',class:'modal-shell'},slots.default?.({type:'dialog'})):null;}});
export const Engagement=defineComponent({props:{immersive:Boolean},setup:(props,{slots})=>()=>h('div',{style:{height:'100%'}},[slots.default?.(),slots.afterActions?.(),h('div',{style:props.immersive?{position:'absolute',right:'16px',bottom:'160px',zIndex:2}:{}},slots.remixAction?.())])});
export const Media=defineComponent({setup:()=>()=>h('div',{class:'artwork'},[h('span','原作品'),h('p','午后花园里的橘猫')])});`;
  const entry = `import {createApp,defineAsyncComponent,h,ref} from 'vue';import Root from '@/components/MkBackgroundStudio.vue';import Detail from '@/pages/community/work-detail.vue';import Creation from '@/pages/creation.vue';import {Header,Button} from 'runtime';import {backgroundStudio,queueBackgroundRemix,studioAnchor} from '@/utility/background-studio.js';
window.__state=backgroundStudio;window.__queue=queueBackgroundRemix;const page=ref(window.__initialPath||'/community/work/test');window.__router={push(path,options){page.value=path.replace(':kind',options?.params?.kind||'image')},pushByPath(path){page.value=path}};window.__navigate=path=>{page.value=path};const DeferredRoot=defineAsyncComponent(()=>new Promise(resolve=>setTimeout(()=>resolve(Root),75)));
const app=createApp({render:()=>h('div',[h('header',{class:'site-header'},'AI 创作社区'),page.value.startsWith('/create/')?h(Creation,{kind:page.value.split('/')[2]}):h(Detail,{submissionId:'original'}),h(DeferredRoot)])});app.component('PageWithHeader',Header);app.component('MkA',Button);app.component('MkLoading',Button);app.component('Mfm',{props:['text'],render(){return h('span',this.text)}});app.config.errorHandler=e=>window.__errors.push(e.message);app.mount('#app');`;
  const bundle = await esbuild.build({ stdin: { contents: entry, loader: 'ts', resolveDir: path.join(root,'packages/frontend') }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' }, plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^runtime$/ }, () => ({ path: 'runtime', namespace: 'mock' }));
    b.onResolve({ filter: /^@@?\// }, a => { const rel=a.path.replace(/^@@?\//,'').replace(/\.js$/,'.ts');return actual.has(rel)?{path:path.join(src,rel),namespace:'actual'}:{path:a.path,namespace:'mock'}; });
    b.onResolve({ filter: /^\.\//, namespace:'actual' }, a => {const file=path.resolve(path.dirname(a.importer),a.path).replace(/\.js$/,'.ts'),rel=path.relative(src,file).replace(/\\/g,'/');return {path:file,namespace:actual.has(rel)?'actual':'mock'};});
    b.onLoad({ filter: /.*/, namespace: 'actual' }, a => ({ contents: compiled.get(a.path)||fs.readFileSync(a.path,'utf8'),loader:'ts',resolveDir:path.join(root,'packages/frontend') }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:a.path==='runtime'?runtime:a.path.endsWith('MkButton.vue')?"export {Button as default} from 'runtime'":a.path.endsWith('MkModal.vue')?"export {ModalShell as default} from 'runtime'":a.path.endsWith('work-engagement.vue')?"export {Engagement as default} from 'runtime'":a.path.endsWith('work-media.vue')?"export {Media as default} from 'runtime'":a.path.endsWith('.vue')?"export {Stub as default} from 'runtime'":"export * from 'runtime'",loader:'ts',resolveDir:path.join(root,'packages/frontend') }));
  }}] });
  return { script:bundle.outputFiles[0].text, css };
}

(async()=>{
  fs.mkdirSync(output,{recursive:true}); const built=await buildFixture(), browser=await chromium.launch({headless:true,...(process.env.BACKGROUND_TEST_PROXY?{proxy:{server:process.env.BACKGROUND_TEST_PROXY}}:{})}); const report=[];
  try { for(const width of (process.env.BACKGROUND_TEST_WIDTHS||'1440,390,320').split(',').map(Number)) {
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<500,serviceWorkers:'block',bypassCSP:true,acceptDownloads:true}),page=await context.newPage();
    let posts=0,documents=0,done=false,videoDone=false,imageFailed=false;const errors=[],requests=[];
    const waitPosts=async count=>{for(let i=0;i<600&&posts<count;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(posts,count)};
    const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6P9sAAAAASUVORK5CYII=','base64');
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
      const u=new URL(route.request().url()),method=route.request().method();requests.push(method+' '+u.pathname);
      if(u.origin!==origin)return route.abort();
      if(u.pathname==='/__fixture')return route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'});
      if(u.pathname==='/result.png')return route.fulfill({contentType:'image/png',body:pixel});
      if(u.pathname.endsWith('/videos/video-job/content'))return route.fulfill({contentType:'video/mp4',body:Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPWbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAggAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAwF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAggAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAIIAAAEAAABAAAAAAJ5bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAGgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACJG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAeRzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4xOS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAL/+EAGWdkAAus2UKN+TARAAADAAEAAAMAMg8UKZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAANkQAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAA0AAAIAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAB4Y3R0cwAAAAAAAAANAAAAAQAABAAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAA0AAAABAAAASHN0c3oAAAAAAAAAAAAAAA0AAALbAAAADwAAAA0AAAAMAAAADAAAABUAAAAPAAAADAAAAAwAAAAVAAAADwAAAAwAAAAMAAAAFHN0Y28AAAAAAAAAAQAABAYAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYyLjYuMTAxAAAACGZyZWUAAAOPbWRhdAAAAqAGBf//nNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAzZYiEADv//uOr+BTNM4HMctk5W2NGNPzxSXbPITNxywVQ/PquVu8GW2S0vyAMgABeQf/5AAAAC0GaJGxDf/6nhAHHAAAACUGeQniF/wDzgQAAAAgBnmF0Qr8BUwAAAAgBnmNqQr8BUwAAABFBmmhJqEFomUwIZ//+nhAGzQAAAAtBnoZFESwv/wDzgQAAAAgBnqV0Qr8BUwAAAAgBnqdqQr8BUwAAABFBmqxJqEFsmUwIV//+OEAaMAAAAAtBnspFFSwv/wDzgQAAAAgBnul0Qr8BUwAAAAgBnutqQr8BUw==','base64')});
      if(u.pathname.startsWith('/studio/api/')){
        const q=new URL(route.request().frame().url()).searchParams,kind=q.get('kind'),identity={context:q.get('context'),attempt:q.get('attempt'),subject:'9001',userId:'fixtureUser'};
        const session={authenticated:true,user:{id:9001,username:'fixture',display_name:'Fixture',quota:100000,used_quota:0,request_count:0,group:'default'},selectedTokenId:1};
        const config={newApiEnabled:true,needCode:false,hideUserApiKey:true,disableFastLink:true,customModels:'',defaultModel:'gpt-6.1-sol'};let body={success:true,data:[]};
        if(u.pathname.endsWith('/embedded/init'))body={status:'verify',...identity,kind};
        else if(u.pathname.endsWith('/embedded/verify'))body={status:'ready',...identity,kind};
        else if(u.pathname==='/studio/api/new-api/bootstrap')body={success:true,data:{session,config}};
        else if(u.pathname==='/studio/api/new-api/session')body={success:true,data:session};
        else if(u.pathname==='/studio/api/config')body=config;
        else if(u.pathname.endsWith('/models')||u.pathname.endsWith('/remote-models'))body={object:'list',data:[{id:'gpt-6.1-sol'},{id:'gpt-image-2.6'},{id:'sora-2'}]};
        else if(u.pathname==='/studio/api/new-api/status')body={success:true,data:{enabled:true,configured:true}};
        else if(u.pathname==='/studio/api/mcp')body={success:true,enabled:false,servers:[]};
        else if(u.pathname.includes('/async-images/v1/tasks')){if(method==='POST'){posts++;body={id:'image-job-'+posts,status:'queued'}}else body=imageFailed?{id:'image-job',status:'failed',error:'测试：模型额度不足'}:done?{id:'image-job',status:'succeeded',data:[{url:origin+'/result.png'}]}:{id:'image-job',status:'generating'};}
        else if(u.pathname.endsWith('/videos')&&method==='POST'){posts++;body={id:'video-job',status:'queued'};}
        else if(u.pathname.includes('/videos/video-job'))body=videoDone?{id:'video-job',status:'completed',url:origin+'/video.mp4'}:{id:'video-job',status:'in_progress'};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      }
      if(u.pathname.startsWith('/studio')){if(route.request().isNavigationRequest())documents++;try{const response=await route.fetch({url:studioUrl+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(origin).host,'x-forwarded-host':new URL(origin).host},timeout:180000});return route.fulfill({response});}catch{return route.abort();}}
      return route.abort();
    });
    const boot=async(initialPath='/community/work/test')=>{
      await page.goto(origin+'/__fixture');
      await page.evaluate(value=>{window.__initialPath=value},initialPath);
      await page.evaluate(()=>{window.__errors=[];window.__notices=[];window.__messages=[];window.addEventListener('message',e=>window.__messages.push(e.data));window.__work={id:'original',title:'午后花园里的橘猫',category:'image',text:'An orange cat in a quiet garden',model:'gpt-image-2.6',files:[],referenceFiles:[],tags:[],author:{username:'creator',name:'创作者'},submittedAt:'2026-11-10T08:00:00Z'};localStorage.setItem('lang','zh-CN');});
      await page.addStyleTag({content:':root{--MI_THEME-bg:#f4f6f7;--MI_THEME-panel:#fff;--MI_THEME-fg:#253536;--MI_THEME-accent:#357f80;--MI_THEME-fgOnAccent:#fff;--MI_THEME-divider:#dce4e4;--MI_THEME-navBg:#fff;--MI_THEME-header: #fff}*{box-sizing:border-box}body{margin:0;font:14px Arial}.site-header{height:64px;display:flex;align-items:center;padding:0 32px;font-weight:bold;font-size:20px;background:white}#app{height:100vh;container-type:size}.page-shell{height:calc(100vh - 64px);container-type:size}button{font:inherit;cursor:pointer}._button{border:0;background:none;color:inherit}.modal-shell{position:fixed;inset:0;background:#0005;display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px}.artwork{display:grid;place-content:center;height:650px;width:100%;color:#fff;background:#49645b;font-size:24px}.artwork p{font-size:40px}'+built.css});
      await page.addScriptTag({content:built.script});
    };
    try {
      await boot(); await page.getByTestId('work-remix').click(); await page.getByTestId('remix-options').waitFor();
      await page.screenshot({path:path.join(output,`options-${width}.png`),fullPage:true});
      await page.getByTestId('remix-background').click(); await page.getByTestId('background-task-window').waitFor();
      await page.waitForFunction(()=>window.__state.tasks.some(task=>task.sessionId),null,{timeout:180000});
      await waitPosts(1);const firstId=await page.evaluate(()=>window.__state.tasks[0].id);
      const handle=page.getByTestId('background-task-handle'),before=await handle.boundingBox();
      await page.mouse.move(before.x+70,before.y+25);await page.mouse.down();await page.mouse.move(before.x-60,before.y-200,{steps:8});await page.mouse.up();
      assert.equal(await page.getByTestId('studio-anchor').count(),0,'drag must not navigate');
      assert((await handle.boundingBox()).y<before.y-100);
      if(width<500){
        const touch=await context.newCDPSession(page),rect=await handle.boundingBox();
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+60,y:rect.y+20}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+80,y:rect.y-80}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
        assert.equal(await page.getByTestId('studio-anchor').count(),0,'cancelled touch must not navigate');
        const moved=await handle.boundingBox();await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:moved.x+60,y:moved.y+20}]});await page.waitForTimeout(750);await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
      }else{const moved=await handle.boundingBox();await page.mouse.move(moved.x+60,moved.y+20);await page.mouse.down();await page.waitForTimeout(750);await page.mouse.up();}
      await page.getByTestId('background-restore').waitFor();
      done=true;await page.getByTestId('background-open-result').waitFor({timeout:15000});
      assert((await page.evaluate(()=>window.__notices)).some(value=>value.includes('完成')));
      await page.getByTestId('background-open-result').click();await page.getByTestId('background-result').locator('img').waitFor({timeout:15000});
      const download=page.waitForEvent('download');await page.getByRole('link',{name:'下载',exact:true}).click();assert((await download).suggestedFilename().endsWith('.png'));
      await page.screenshot({path:path.join(output,`result-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'前往 AI 工作台',exact:true}).click();
      await page.getByTestId('studio-anchor').waitFor();await page.waitForFunction(id=>window.__messages.some(message=>message.status==='background-opened'&&message.requestId===id),firstId,{timeout:20000});
      const frame=page.frameLocator('iframe');await frame.locator('#chat-input').waitFor({timeout:20000});
      assert.equal(documents,1,'community and workbench share the same studio document');
      await page.screenshot({path:path.join(output,`workbench-${width}.png`),fullPage:true});
      await page.evaluate(()=>window.__navigate('/community/work/test'));await page.getByTestId('work-remix').click();await page.getByTestId('remix-workbench').click();
      await page.waitForFunction(()=>window.__messages.some(message=>message.status==='remix-applied'),null,{timeout:20000});
      assert.equal(await frame.locator('#chat-input').inputValue(),'An orange cat in a quiet garden');assert.equal(posts,1,'manual option does not submit');
      await boot('/create/video');await page.waitForFunction(()=>window.__messages.some(message=>message.status==='workspace-ready'&&message.kind==='video'),null,{timeout:30000});
      assert.equal(await page.evaluate(()=>window.__state.kind),'video','cached image task must not replace requested video workspace');
      await page.getByTestId('background-task-handle').click();await frame.locator('#chat-input').waitFor({timeout:30000});
      assert.equal(posts,1,'reload only restores; it never resubmits');
      await page.evaluate(()=>{window.__navigate('/community/work/test');window.__queue({requestId:crypto.randomUUID(),sourceWorkId:'videoSource',kind:'video',model:'sora-2',prompt:'A quiet ocean',references:[]})});
      await waitPosts(2);videoDone=true;await page.waitForFunction(()=>window.__state.tasks.some(task=>task.kind==='video'&&task.state==='complete'),null,{timeout:20000});
      await page.getByTestId('background-open-result').click();await page.getByTestId('background-result').locator('video').waitFor({timeout:15000});
      await page.waitForFunction(()=>document.querySelector('[data-testid=background-result] video')?.readyState>=1);
      const videoDownload=page.waitForEvent('download');await page.getByRole('link',{name:'下载',exact:true}).click();assert((await videoDownload).suggestedFilename().endsWith('.mp4'));
      await page.getByRole('button',{name:'前往 AI 工作台',exact:true}).click();
      await page.waitForFunction(()=>window.__messages.some(message=>message.status==='background-opened'&&window.__state.tasks.some(task=>task.id===message.requestId&&task.kind==='video')),null,{timeout:20000});
      assert.equal(await page.evaluate(()=>window.__state.kind),'video');
      imageFailed=true;await page.evaluate(()=>{window.__navigate('/community/work/test');window.__queue({requestId:crypto.randomUUID(),sourceWorkId:'original',kind:'image',model:'gpt-image-2.6',prompt:'A failed task',references:[]})});await waitPosts(3);
      await page.waitForFunction(()=>window.__state.tasks.some(task=>task.state==='error'&&task.message.includes('额度不足')),null,{timeout:15000});
      await page.screenshot({path:path.join(output,`failure-state-${width}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(await page.evaluate(()=>window.__errors),[]);assert.deepEqual(errors,[]);
      report.push({width,mockedPaidSubmissions:posts,iframeDocuments:documents,checks:['two choices','background generation','drag','long press hide','touch cancellation','completion notification','image/video preview and download','cross-kind workbench task','manual draft only','reload recovery','deferred anchor initialization','generation error','no overflow']});console.log('PASS viewport '+width);
    } catch(error) {await page.screenshot({path:path.join(output,`failure-${width}.png`),fullPage:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),errors,requests,messages:await page.evaluate(()=>window.__messages),vueErrors:await page.evaluate(()=>window.__errors)},null,2));throw error;}
    finally{await context.close();}
  }}finally{await browser.close();}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1});
