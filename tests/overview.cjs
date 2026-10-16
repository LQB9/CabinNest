const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('./runtime.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa-ui');fs.mkdirSync(qa,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(qa,'overview-')),env={...process.env,PROJECTDESK_DATA_DIR:dataDir,PROJECTDESK_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'build-app')],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByLabel('快速添加待办').waitFor();}
async function waitFor(fn,arg){const end=Date.now()+10000;while(Date.now()<end){if(await page.evaluate(fn,arg))return;await new Promise(r=>setTimeout(r,50));}throw new Error('State did not settle');}
async function overview(){const narrow=await page.locator('.sidebar').isHidden();await(narrow?page.getByRole('tab',{name:'总览',exact:true}):page.locator('.primary-nav').getByRole('button',{name:'总览',exact:true})).click();await page.locator('.overview-page').waitFor();}
async function stats(){return page.locator('[data-stat]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.stat,parseInt(n.textContent)])));}
async function expectStats(value){await waitFor(value=>Object.entries(value).every(([k,v])=>parseInt(document.querySelector(`[data-stat="${k}"]`)?.textContent)===v),value);assert.deepEqual(await stats(),value);}
async function run(){
 await launch();await overview();await expectStats({pending:0,projects:0,done:0,overdue:0});assert.ok(await page.getByText('还没有项目',{exact:true}).isVisible());
 const ids=await page.evaluate(async()=>{
  const a=await window.desk.saveProject({name:'采购协同平台',code:'MM-2026'}),b=await window.desk.saveProject({name:'生产执行优化',code:'PP-2026'});
  await window.desk.saveProject({name:'SAP 技术资料库',status:'已完成'});
  for(let i=1;i<=3;i++)await window.desk.saveProject({name:`其他项目 ${i}`});
  await window.desk.createNote({title:'采购审批功能说明',projectId:a.id,type:'FS 功能说明书'});
  const late=await window.desk.saveTask({title:'确认采购审批异常规则',projectId:a.id,dueDate:'2000-01-01'});
  await window.desk.saveTask({title:'核对采购字段',projectId:a.id,status:'doing',dueDate:'2099-01-01'});
  const d=new Date(),today=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  await window.desk.saveTask({title:'生产接口联调',projectId:b.id,dueDate:today});
  await window.desk.saveTask({title:'已确认审批范围',projectId:a.id,status:'done',dueDate:'2000-01-01'});
  const done=await window.desk.saveTask({title:'已归档周会纪要',status:'done'});
  const deleted=await window.desk.saveTask({title:'回收站事项不应计数',dueDate:'2000-01-01'});await window.desk.trash('task',deleted.id);
  await window.desk.saveTask({title:'整理交接清单'});return{a,b,late,done};
 });
 await expectStats({pending:4,projects:6,done:2,overdue:1});assert.equal(await page.locator('.overview-projects .project-summary-row').count(),5);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.waitForTimeout(250);await page.screenshot({path:path.join(qa,'overview-window.png'),timeout:15000});
 await page.getByRole('button',{name:'查看所有项目',exact:true}).click();await page.locator('.projects-directory').waitFor();assert.equal(await page.locator('.project-summary-row').count(),6);
 await page.getByRole('button',{name:'打开项目 采购协同平台',exact:true}).click();await page.locator('.document-row').waitFor();assert.equal(await page.getByLabel('当前项目',{exact:true}).inputValue(),ids.a.id);
 await overview();await expectStats({pending:4,projects:6,done:2,overdue:1});
 await page.getByRole('button',{name:'查看未完成待办',exact:true}).click();await waitFor(()=>document.querySelectorAll('.task-row').length===4);assert.equal(await page.getByLabel('按项目筛选待办').inputValue(),'');
 await overview();await page.getByRole('button',{name:'查看已完成待办',exact:true}).click();await waitFor(()=>document.querySelectorAll('.task-row').length===2);assert.equal(await page.locator('.segmented .active').textContent(),'已完成');
 await overview();await page.getByRole('button',{name:'查看已逾期待办',exact:true}).click();await waitFor(()=>document.querySelectorAll('.task-row').length===1);assert.equal(await page.getByLabel('按截止日期筛选').inputValue(),'overdue');
 await page.locator('.task-row').getByLabel('标记完成',{exact:true}).click();await overview();await expectStats({pending:3,projects:6,done:3,overdue:0});
 const added=await page.evaluate(async pid=>{await window.desk.saveProject({name:'新增的项目'});return window.desk.saveTask({title:'补充生产交接说明',projectId:pid});},ids.b.id);
 await expectStats({pending:4,projects:7,done:3,overdue:0});
 await page.evaluate(id=>window.desk.saveTask({id,status:'done'}),added.id);await expectStats({pending:3,projects:7,done:4,overdue:0});
 await page.evaluate(id=>window.desk.trash('task',id),ids.done.id);await expectStats({pending:3,projects:7,done:3,overdue:0});
 await page.evaluate(id=>window.desk.trash('task',id,true),ids.done.id);await expectStats({pending:3,projects:7,done:4,overdue:0});
 await page.evaluate(()=>window.desk.setPresentation('edge'));await page.waitForFunction(()=>document.querySelector('.mode-edge'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
 assert.equal(await page.getByRole('tab',{name:'总览',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.getByRole('tab',{name:/项目/}).getAttribute('aria-selected'),'false');
 await page.screenshot({path:path.join(qa,'overview-edge.png'),timeout:15000});
 await page.getByRole('button',{name:'全部项目',exact:true}).click();await page.getByRole('button',{name:'查看 采购协同平台 的未完成待办',exact:true}).click();await page.getByLabel('快速添加待办').waitFor();assert.equal(await page.getByLabel('按项目筛选待办').inputValue(),ids.a.id);assert.equal(await page.locator('.task-row').count(),1);
 await overview();await page.evaluate(()=>window.desk.setPresentation('tray'));await page.waitForFunction(()=>document.querySelector('.mode-tray'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
 await page.getByRole('button',{name:'查看未完成待办',exact:true}).click();await waitFor(()=>document.querySelectorAll('.task-row').length===3);assert.equal(await page.getByLabel('按项目筛选待办').inputValue(),'');
 await app.close();app=null;await launch();assert.equal(await page.locator('.overview-page').count(),0);assert.equal(await page.getByLabel('按项目筛选待办').inputValue(),'');await overview();await expectStats({pending:3,projects:7,done:4,overdue:0});
 assert.deepEqual(errors,[]);console.log('OVERVIEW_OK',JSON.stringify({dataDir,counts:true,trashExcluded:true,linksAndFilters:true,liveUpdates:true,projectDirectory:true,threeModes:true,startupTasksPreserved:true}));await app.close();app=null;
}
run().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(qa,'overview-failure.png'),timeout:5000});}catch{}try{await app?.close();}catch{}process.exitCode=1;});
