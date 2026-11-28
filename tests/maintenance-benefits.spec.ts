import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { MaintenanceBenefit, MaintenanceClaim } from '../shared/maintenance-benefits'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
async function fixture(page: Page, admin = false) {
  const account = await mockUnifiedAccount(page,true); account.state.user.isAdmin = admin
  const item: MaintenanceBenefit = { id:'benefit1', version:1, title:'网站维护福利', content:'维护已完成，感谢你的理解与支持。', credits:88,
    rewardType:'timed', rewardValidityDays:30, startsAt:new Date(Date.now()-3600000).toISOString(), endsAt:new Date(Date.now()+86400000).toISOString(),
    popupMaxDisplays:3, popupIntervalMinutes:60, isActive:true, createdAt:new Date().toISOString(), recipientCount:18,claimedCount:12,pendingCount:0,totalDisplays:24 }
  const state = { items:[item], writes:[] as any[], displays:0, claimed:null as MaintenanceClaim|null, claimPosts:0, error:0, claimError:0, pending:false, readError:false }
  await page.route('**/api/admin/maintenance-benefits*',route=>{
    if(state.readError) return route.fulfill({status:503,json:{message:'福利读取暂不可用'}})
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON();state.writes.push(body)
      if(state.error)return route.fulfill({status:state.error,json:{message:'活动已被修改，请刷新后重新编辑。'}})
      const value={...item,...body.definition,id:body.id,version:body.version+1,isActive:body.isActive}
      state.items=state.items.filter(v=>v.id!==body.id).map(v=>({...v,isActive:body.isActive?false:v.isActive}));state.items.unshift(value)
      return route.fulfill({json:{benefit:value}})
    }
    return route.fulfill({json:{benefits:state.items,nextCursor:null}})
  })
  await page.route('**/api/maintenance-benefit**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path.endsWith('/records'))return route.fulfill({json:{items:state.claimed?[{id:'record1',benefitId:item.id,title:item.title,claimedAt:new Date().toISOString(),claim:state.claimed}]:[],nextCursor:null}})
    if(path.endsWith('/display')){state.displays++;return route.fulfill({json:{benefit:state.displays===1?item:null,claim:state.claimed}})}
    if(path.endsWith('/claim')){
      state.claimPosts++
      if(state.claimError)return route.fulfill({status:state.claimError,json:{message:'这期福利已结束或已停用。'}})
      state.claimed={credits:88,rewardValidityDays:30,status:state.pending?'pending':'fulfilled',expiresAt:state.pending?null:Math.floor(Date.now()/1000)+30*86400,reference:'original-reference'}
      return route.fulfill({json:{claim:state.claimed}})
    }
    return route.fulfill({json:{benefit:state.displays||state.claimed?null:item,claim:state.claimed}})
  })
  return {state,account}
}

test('independent admin tab creates timed benefits with editable expiry and complete popup settings',async({page})=>{
  const {state}=await fixture(page,true);await page.goto('/admin?tab=maintenance')
  await expect(page.getByRole('heading',{name:'维护福利',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'新建福利',exact:true}).click()
  await expect(page.getByLabel('积分有效期（天）')).toHaveValue('30')
  await expect(page.locator('.maintenance-editor')).toContainText('限时福利积分')
  await page.getByLabel('福利标题').fill('停机维护补偿')
  await page.getByLabel('每人领取积分').fill('188')
  await page.getByLabel('积分有效期（天）').fill('7')
  await page.getByLabel('每人最多弹窗次数').fill('4')
  await page.getByLabel('弹窗间隔（分钟）').fill('30')
  await page.getByLabel('启用此活动（会停用其他活动）').check()
  await page.getByRole('button',{name:'保存福利',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'维护福利已保存'})).toBeVisible()
  expect(state.writes[0]).toMatchObject({version:0,isActive:true,definition:{rewardType:'timed',rewardValidityDays:7,credits:188,popupMaxDisplays:4,popupIntervalMinutes:30}})
  expect(state.items.filter(i=>i.isActive)).toHaveLength(1)
})
test('editing conflicts preserve the draft and leaving requires confirmation',async({page})=>{
  const {state}=await fixture(page,true);state.error=409;await page.goto('/admin?tab=maintenance')
  await page.getByRole('button',{name:'编辑',exact:true}).click()
  await page.getByLabel('福利标题').fill('我的未保存修改')
  await page.getByRole('button',{name:'保存福利',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('活动已被修改')
  await expect(page.getByLabel('福利标题')).toHaveValue('我的未保存修改')
  await page.getByRole('button',{name:'取消编辑',exact:true}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(state.writes).toHaveLength(1)
})
test('enable and disable use the exact original version',async({page})=>{
  const {state}=await fixture(page,true);await page.goto('/admin?tab=maintenance')
  await page.getByRole('button',{name:'停用',exact:true}).click()
  await expect(page.getByRole('button',{name:'启用',exact:true})).toBeVisible()
  expect(state.writes[0]).toMatchObject({id:'benefit1',version:1,isActive:false})
  await page.getByRole('button',{name:'启用',exact:true}).click()
  await expect(page.getByRole('button',{name:'停用',exact:true})).toBeVisible()
  expect(state.writes[1]).toMatchObject({id:'benefit1',version:2,isActive:true})
})
for(const width of [320,390,1440])test(`admin maintenance layout, keyboard and accessibility at ${width}px`,async({page},info)=>{
  await fixture(page,true);await page.setViewportSize({width,height:1000});await page.goto('/admin?tab=maintenance')
  await page.getByRole('button',{name:'新建福利',exact:true}).click()
  await expect(page.getByLabel('福利标题')).toBeFocused()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect((await new AxeBuilder({page}).include('.maintenance-admin').analyze()).violations).toEqual([])
  await page.screenshot({path:info.outputPath(`maintenance-admin-${width}.png`),fullPage:true})
})
for(const width of [320,390,1440])test(`user claims timed points and close never repeats at ${width}px`,async({page},info)=>{
  const {state}=await fixture(page);await page.setViewportSize({width,height:900});await page.goto('/discover')
  const modal=page.getByRole('dialog',{name:'网站维护福利',exact:true})
  await expect(modal).toBeVisible();await expect(modal).toContainText('到账后 30 天有效')
  await expect(page.getByRole('button',{name:'关闭维护福利',exact:true})).toBeFocused()
  expect((await new AxeBuilder({page}).include('.maintenance-prompt').analyze()).violations).toEqual([])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath(`maintenance-prompt-${width}.png`),fullPage:true})
  await modal.getByRole('button',{name:'领取福利积分',exact:true}).click()
  await expect(modal).toContainText('领取成功，福利积分已到账。');await expect(modal).toContainText('有效至')
  await page.keyboard.press('Escape');await expect(modal).not.toBeVisible();await page.reload();await page.waitForTimeout(2200)
  await expect(modal).not.toBeVisible();expect(state.claimPosts).toBe(1);expect(state.displays).toBe(1)
})
test('pending receipt shows no false success and refresh uses read-only status',async({page})=>{
  const {state}=await fixture(page);state.pending=true;await page.goto('/discover')
  const modal=page.getByRole('dialog',{name:'网站维护福利',exact:true});await expect(modal).toBeVisible()
  await modal.getByRole('button',{name:'领取福利积分',exact:true}).click();await expect(modal).toContainText('积分正在发放')
  state.claimed!.status='fulfilled';state.claimed!.expiresAt=Math.floor(Date.now()/1000)+30*86400
  await modal.getByRole('button',{name:'刷新到账状态',exact:true}).click();await expect(modal).toContainText('福利积分已到账')
  expect(state.claimPosts).toBe(1)
})
test('closed pending claim stays accessible in welfare records after campaign changes',async({page})=>{
  const {state}=await fixture(page);state.pending=true;await page.goto('/discover')
  const modal=page.getByRole('dialog',{name:'网站维护福利',exact:true});await expect(modal).toBeVisible()
  await modal.getByRole('button',{name:'领取福利积分',exact:true}).click();await expect(modal).toContainText('积分正在发放')
  await modal.getByRole('link',{name:'查看维护福利领取记录',exact:true}).click()
  const records=page.getByRole('region',{name:'维护福利领取记录',exact:true})
  await expect(records).toContainText('发放中');state.claimed!.status='fulfilled'
  await records.getByRole('button',{name:'刷新维护福利',exact:true}).click();await expect(records).toContainText('已到账')
  expect(state.claimPosts).toBe(1)
})
test('expired claim errors stay in the prompt and close remains usable',async({page})=>{
  const {state}=await fixture(page);state.claimError=409;await page.goto('/discover')
  const modal=page.getByRole('dialog',{name:'网站维护福利',exact:true});await expect(modal).toBeVisible()
  await modal.getByRole('button',{name:'领取福利积分',exact:true}).click();await expect(modal.getByRole('alert')).toContainText('已结束')
  await page.getByRole('button',{name:'关闭维护福利',exact:true}).click();await expect(modal).not.toBeVisible()
})
for(const path of ['/admin?tab=maintenance','/create/image','/account?tab=storage','/storage-recovery'])test(`does not interrupt ${path}`,async({page})=>{
  const {state}=await fixture(page,true);await page.goto(path);await page.waitForTimeout(2300)
  await expect(page.locator('.maintenance-prompt')).not.toBeVisible();expect(state.displays).toBe(0)
})
test('an existing modal postpones the benefit without consuming a display',async({page})=>{
  const {state}=await fixture(page);await page.goto('/discover')
  await page.evaluate(()=>{const d=document.createElement('dialog');d.id='other-modal';d.textContent='进行中的操作';document.body.append(d);d.showModal()})
  await page.waitForTimeout(2500);expect(state.displays).toBe(0)
  await page.evaluate(()=>{const d=document.querySelector<HTMLDialogElement>('#other-modal')!;d.close();d.remove()})
  await expect(page.getByRole('dialog',{name:'网站维护福利',exact:true})).toBeVisible({timeout:8000});expect(state.displays).toBe(1)
})
