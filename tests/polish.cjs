const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('./runtime.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa-ui');fs.mkdirSync(qa,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(qa,'polish-')),env={...process.env,PROJECTDESK_DATA_DIR:dataDir,PROJECTDESK_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
async function waitFor(fn,arg){const end=Date.now()+10000;while(Date.now()<end){if(await page.evaluate(fn,arg))return;await new Promise(r=>setTimeout(r,50));}throw new Error('State did not settle');}
async function shot(name){if(await page.getByLabel('关闭提示').isVisible())await page.getByLabel('关闭提示').click();await page.evaluate(()=>{document.activeElement?.blur();});await page.waitForTimeout(150);await page.screenshot({path:path.join(qa,`polish-${name}.png`),timeout:15000});}
async function layout(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'Window must not overflow horizontally');}
async function run(){
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'build-app')],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByLabel('快速添加待办').waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
 const ids=await page.evaluate(async()=>{
  const a=await window.desk.saveProject({name:'采购协同平台',code:'MM-2026'}),b=await window.desk.saveProject({name:'生产执行优化',code:'PP-2026'});
  const doc=await window.desk.createNote({title:'采购审批功能说明',projectId:a.id,type:'FS 功能说明书'});
  await window.desk.createNote({title:'供应商接口技术交接',projectId:a.id,type:'技术交接'});
  await window.desk.saveTask({title:'确认采购审批的异常处理规则',projectId:a.id,documentId:doc.id,priority:'high',dueDate:'2020-01-01'});
  await window.desk.saveTask({title:'完成生产报工接口联调',projectId:b.id,status:'doing'});
  await window.desk.saveTask({title:'整理今天的技术交接记录'});
  await window.desk.saveTask({title:'确认需求范围',projectId:a.id,status:'done'});return{a,b,doc};
 });
 await waitFor(()=>document.querySelectorAll('.task-row').length===3);
 const quick=page.getByLabel('快速添加待办');await quick.fill('复核字段映射');await page.getByLabel('新待办所属项目').selectOption(ids.b.id);
 await page.getByRole('button',{name:'新建待办',exact:true}).click();let dialog=page.getByRole('dialog',{name:'新建待办'});await dialog.waitFor();
 assert.equal(await dialog.getByLabel('待办内容 *').inputValue(),'复核字段映射');assert.equal(await dialog.getByLabel('所属项目',{exact:true}).inputValue(),ids.b.id);
 assert.ok(await page.evaluate(()=>document.querySelector('.main').inert&&document.querySelector('.sidebar').inert));
 await dialog.getByRole('button',{name:'保存待办',exact:true}).focus();await page.keyboard.press('Tab');assert.ok(await dialog.getByRole('button',{name:'关闭窗口'}).evaluate(e=>e===document.activeElement));
 await page.keyboard.press('Shift+Tab');assert.ok(await dialog.getByRole('button',{name:'保存待办',exact:true}).evaluate(e=>e===document.activeElement));
 await page.keyboard.press('Control+n');assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await dialog.count(),1,'Global shortcuts must not replace a form');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.ok(await page.getByRole('button',{name:'新建待办',exact:true}).evaluate(e=>e===document.activeElement));assert.equal(await quick.inputValue(),'复核字段映射');
 await page.getByRole('button',{name:'新建待办',exact:true}).click();dialog=page.getByRole('dialog',{name:'新建待办'});await dialog.getByLabel('截止日期').fill('2099-01-01');await dialog.getByRole('button',{name:'保存待办',exact:true}).click();
 await waitFor(()=>document.querySelectorAll('.task-row').length===4);assert.equal(await quick.inputValue(),'');let state=await page.evaluate(()=>window.desk.bootstrap());const created=state.tasks.filter(t=>t.title==='复核字段映射');assert.equal(created.length,1);assert.equal(created[0].project_id,ids.b.id);assert.equal(created[0].due_date,'2099-01-01');
 await shot('tasks-window');await layout();
 // Check actual rendered colors rather than just checking token definitions.
 const contrast=await page.evaluate(()=>{
  const luminance=rgb=>{const c=rgb.match(/[\d.]+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
  return ['.task-content strong','.task-project select','.task-scope-label','.segmented button.active','.primary-nav .active'].map(selector=>{const e=document.querySelector(selector),s=getComputedStyle(e);let n=e,bg;while(n){const b=getComputedStyle(n).backgroundColor;if(b!=='rgba(0, 0, 0, 0)'&&b!=='transparent'){bg=b;break;}n=n.parentElement;}const a=luminance(s.color),b=luminance(bg||'rgb(255,255,255)');return{selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
 });contrast.forEach(item=>assert.ok(item.ratio>=4.5,JSON.stringify(item)));
 await page.getByLabel('切换使用方式').click();assert.ok(await page.getByRole('menuitemradio',{name:'独立窗口',exact:true}).evaluate(e=>e===document.activeElement));await page.keyboard.press('End');assert.ok(await page.getByRole('menuitem',{name:'退出应用',exact:true}).evaluate(e=>e===document.activeElement));await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');assert.ok(await page.getByRole('menuitemradio',{name:'侧边面板',exact:true}).evaluate(e=>e===document.activeElement));await page.keyboard.press('Escape');assert.ok(await page.getByLabel('切换使用方式').evaluate(e=>e===document.activeElement));
 await page.locator('.primary-nav').getByRole('button',{name:'总览',exact:true}).click();await page.locator('.overview-page').waitFor();await shot('overview-window');
 await page.getByRole('button',{name:'打开项目 采购协同平台',exact:true}).click();await page.locator('.document-row').first().waitFor();await shot('documents-window');
 await page.locator('.document-title').filter({hasText:'采购审批功能说明'}).click();await page.locator('.document-editor').waitFor();await shot('editor-window');
 await page.getByLabel('资料信息与版本').click();await page.locator('.document-info').waitFor();await layout();await page.getByLabel('关闭资料信息').click();
 await page.getByLabel('备份与设置',{exact:true}).click();await page.locator('.settings-content').waitFor();await shot('settings-window');
 for(const mode of ['edge','tray']){
  await page.evaluate(mode=>window.desk.setPresentation(mode),mode);await page.waitForFunction(mode=>document.querySelector('.mode-'+mode),mode);await layout();
  await page.getByRole('tab',{name:/待办/}).click();await quick.waitFor();await shot(`tasks-${mode}`);await page.getByRole('button',{name:'新建待办',exact:true}).click();dialog=page.getByRole('dialog',{name:'新建待办'});await dialog.waitFor();await layout();assert.ok(await dialog.getByRole('button',{name:'保存待办',exact:true}).evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'Save stays visible in a small window');await shot(`form-${mode}`);await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'总览',exact:true}).focus();await page.keyboard.press('ArrowRight');await quick.waitFor();assert.equal(await page.getByRole('tab',{name:/待办/}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'总览',exact:true}).click();await page.locator('.overview-page').waitFor();await shot(`overview-${mode}`);
 }
 assert.deepEqual(errors,[]);console.log('POLISH_OK',JSON.stringify({dataDir,modalFocus:true,keyboardMenu:true,narrowNavigation:true,draftPreserved:true,threeModeLayout:true,renderedContrast:contrast}));await app.close();app=null;
}
run().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(qa,'polish-failure.png'),timeout:5000});}catch{}try{await app?.close();}catch{}process.exitCode=1;});
