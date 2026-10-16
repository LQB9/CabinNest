const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('./runtime.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa-ui');fs.mkdirSync(qa,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(qa,'compact-'));
const env={...process.env,PROJECTDESK_DATA_DIR:dataDir,PROJECTDESK_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'build-app')],env,timeout:40000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByLabel('快速添加待办').waitFor();}
async function mode(id,label){await page.getByLabel('切换使用方式').click();await page.getByRole('menuitemradio',{name:label,exact:true}).click();await page.waitForFunction(id=>document.querySelector('.app-shell')?.classList.contains('mode-'+id),id);}
async function geometry(){return app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='CabinNest');return{bounds:w.getBounds(),visible:w.isVisible(),area:screen.getDisplayMatching(w.getBounds()).workArea,resizable:w.isResizable(),onTop:w.isAlwaysOnTop()};});}
async function screenshot(name){await page.waitForTimeout(250);await page.screenshot({path:path.join(qa,name+'.png'),timeout:15000});}
async function waitVisibility(visible){const until=Date.now()+10000;while(Date.now()<until){if((await page.evaluate(()=>window.desk.getPresentation())).visible===visible)return;await new Promise(r=>setTimeout(r,50));}throw new Error('Window visibility did not change');}
async function run(){
 await launch();assert.equal((await page.evaluate(()=>window.desk.getPresentation())).trayAvailable,true);
 const ids=await page.evaluate(async()=>{
  const a=await window.desk.saveProject({name:'采购协同平台',code:'MM-2026'}),b=await window.desk.saveProject({name:'生产执行优化',code:'PP-2026'});
  const doc=await window.desk.createNote({title:'采购审批功能说明',type:'FS 功能说明书',projectId:a.id});
  await window.desk.createNote({title:'供应商接口技术交接',type:'技术交接',projectId:a.id});
  await window.desk.createNote({title:'生产报工接口设计',type:'技术设计',projectId:b.id});
  await window.desk.saveTask({title:'确认采购审批的异常规则',projectId:a.id,documentId:doc.id,priority:'high',dueDate:'2020-01-01'});
  await window.desk.saveTask({title:'完成生产报工接口联调',projectId:b.id});
  return{a,b,doc};
 });
 await page.getByRole('button',{name:'项目 采购协同平台',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.document-row').length===2);
 assert.equal(await page.locator('.document-row').count(),2);
 assert.equal(await page.locator('.project-card,.overview-strip,.task-summary,.page-heading').count(),0,'No dashboard content');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
 await screenshot('compact-window');
 await page.locator('.primary-nav').getByRole('button',{name:'待办',exact:true}).click();await page.getByLabel('新待办所属项目').selectOption(ids.a.id);await page.getByLabel('快速添加待办').fill('核对审批字段');await page.getByLabel('快速添加待办').press('Enter');await page.locator('.task-content').getByText('核对审批字段',{exact:true}).waitFor();
 let state=await page.evaluate(()=>window.desk.bootstrap());assert.equal(state.tasks.find(t=>t.title==='核对审批字段').project_id,ids.a.id);
 await page.getByRole('button',{name:'项目 生产执行优化',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.document-row').length===1);await page.locator('.primary-nav').getByRole('button',{name:'待办',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===3);
 await page.getByLabel('按项目筛选待办').selectOption(ids.a.id);assert.equal(await page.locator('.project-entry.active').count(),0);assert.equal(await page.locator('.task-row').count(),2);
 await page.getByLabel('按项目筛选待办').selectOption('');
 console.log('COMPACT_STAGE','project-isolation-and-quick-task');
 // The same document and task view survives all three native presentations.
 await mode('edge','侧边面板');let g=await geometry();assert.ok(Math.abs(g.bounds.x+g.bounds.width-g.area.x-g.area.width)<=1);assert.ok(Math.abs(g.bounds.height-g.area.height)<=1);assert.equal(g.resizable,false);assert.equal(g.onTop,true);
 await page.getByRole('tab',{name:/项目/}).click();await page.getByLabel('当前项目',{exact:true}).selectOption(ids.a.id);await page.waitForFunction(()=>document.querySelectorAll('.document-row').length===2);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth);assert.ok(overflow);
 await screenshot('compact-edge');
 await page.locator('.document-title').filter({hasText:'采购审批功能说明'}).click();await page.locator('.document-editor').waitFor();
 assert.equal(await page.locator('.document-info').count(),0);
 await page.locator('.document-editor').fill('收起到侧边之前需要保存的正文。');
 await page.getByLabel('收起面板').click();await waitVisibility(false);
 const saved=await page.evaluate(id=>window.desk.getDocument(id),ids.doc.id);assert.match(saved.body_html,/需要保存/);
 let handle=app.windows().find(w=>w!==page);if(!handle)handle=await app.waitForEvent('window');await handle.getByRole('button',{name:'展开 CabinNest',exact:true}).waitFor();await handle.getByRole('button',{name:'展开 CabinNest',exact:true}).click();
 await waitVisibility(true);
 assert.equal(await page.locator('.document-editor').count(),1);
 await page.getByRole('button',{name:'资料信息与版本',exact:true}).click();await page.locator('.document-info').waitFor();assert.ok(await page.getByRole('button',{name:/版本记录/}).count());await page.getByLabel('关闭资料信息').click();
 console.log('COMPACT_STAGE','edge-collapse-expand-and-save');
 await page.getByRole('button',{name:'返回资料',exact:true}).click();await mode('tray','托盘弹窗');await page.waitForTimeout(250);g=await geometry();console.log('TRAY_GEOMETRY',JSON.stringify(g));assert.ok(g.bounds.width<=443);assert.ok(g.bounds.height<=603);assert.equal(g.onTop,true);
 assert.equal(await page.getByLabel('当前项目',{exact:true}).inputValue(),ids.a.id);assert.equal(await page.locator('.document-row').count(),2);
 await screenshot('compact-tray');
 await page.getByLabel('收起到托盘').click();await waitVisibility(false);
 // Trigger a normal second launch; the single-instance handler reveals the existing popup.
 const {spawn}=require('node:child_process');const second=spawn(require('electron'),[path.join(root,'build-app')],{env,stdio:'ignore'});await new Promise((resolve,reject)=>{second.once('exit',resolve);second.once('error',reject);});
 await waitVisibility(true);
 await mode('window','独立窗口');g=await geometry();assert.equal(g.resizable,true);assert.equal(g.onTop,false);assert.ok(g.bounds.width>=780);
 assert.equal(await page.getByLabel('当前项目',{exact:true}).inputValue(),ids.a.id);
 // Explicit exit flushes and terminates, unlike closing the compact window.
 await page.getByLabel('切换使用方式').click();const closed=app.waitForEvent('close');await page.getByRole('menuitem',{name:'退出应用',exact:true}).click();await closed;app=null;
 await launch();await page.getByRole('button',{name:'项目',exact:true}).click();assert.equal(await page.getByLabel('当前项目',{exact:true}).inputValue(),ids.a.id);assert.equal((await page.evaluate(()=>window.desk.getPresentation())).mode,'window');
 state=await page.evaluate(()=>window.desk.bootstrap());assert.equal(state.projects.length,2);assert.equal(state.documents.length,3);assert.equal(state.tasks.length,3);assert.deepEqual(errors,[]);
 await app.close();app=null;
 env.PROJECTDESK_TEST='0';await launch();await mode('tray','托盘弹窗');
 await page.locator('.task-doc-link').filter({hasText:'采购审批功能说明'}).click();await page.locator('.document-editor').waitFor();await page.locator('.document-editor').fill('托盘失焦也要保存的正文。');await page.waitForFunction(()=>document.querySelector('.save-indicator')?.textContent.includes('正在编辑'));
 await app.evaluate(({BrowserWindow})=>{global.__focusTarget=new BrowserWindow({width:320,height:180,title:'Test focus target',show:true});global.__focusTarget.focus();});
 await waitVisibility(false);
 assert.match((await page.evaluate(id=>window.desk.getDocument(id),ids.doc.id)).body_html,/托盘失焦也要保存/);
 await app.evaluate(()=>global.__focusTarget.hide());await page.evaluate(()=>window.desk.setPresentation('tray'));await page.getByRole('button',{name:'返回资料',exact:true}).click();
 await app.evaluate(({dialog,BrowserWindow})=>{dialog.showOpenDialog=async()=>{global.__focusTarget.show();global.__focusTarget.focus();await new Promise(r=>setTimeout(r,600));return{canceled:true,filePaths:[]};};});
 const importing=page.evaluate(()=>window.desk.chooseImport({mode:'files'}));await page.waitForTimeout(300);assert.equal((await page.evaluate(()=>window.desk.getPresentation())).visible,true,'A native dialog must not collapse its owner');await importing;await app.evaluate(()=>global.__focusTarget.destroy());
 await mode('window','独立窗口');await page.getByLabel('最大化或还原').click();await mode('edge','侧边面板');g=await geometry();assert.ok(g.bounds.width<=443);await mode('window','独立窗口');
 assert.deepEqual(errors,[]);
 console.log('COMPACT_OK',JSON.stringify({dataDir,modes:3,tray:true,edgeHandle:true,collapseFlush:true,projectIsolation:true,quickTask:true,modeAndScopePersistence:true,blurSave:true,nativeDialogStaysOpen:true,maximizeModeSwitch:true,noDashboard:true}));await app.close();app=null;
}
run().catch(async e=>{console.error(e);try{if(page)await page.screenshot({path:path.join(qa,'compact-failure.png'),timeout:5000});}catch{}try{await app?.close();}catch{}process.exitCode=1;});
