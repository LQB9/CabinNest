const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('./runtime.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa-ui'),dataDir=fs.mkdtempSync(path.join(qa,'peer-tasks-'));
const env={...process.env,PROJECTDESK_DATA_DIR:dataDir,PROJECTDESK_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'build-app')],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByLabel('快速添加待办').waitFor();}
async function waitFor(fn,arg){const end=Date.now()+10000;while(Date.now()<end){if(await page.evaluate(fn,arg))return;await new Promise(r=>setTimeout(r,50));}throw new Error('State did not settle');}
const taskSelect=title=>page.getByLabel('所属项目：'+title,{exact:true});
async function run(){
 await launch();const ids=await page.evaluate(async()=>{
  const a=await window.desk.saveProject({name:'采购协同平台',code:'MM-2026'}),b=await window.desk.saveProject({name:'生产执行优化',code:'PP-2026'});
  const doc=await window.desk.createNote({title:'采购审批功能说明',projectId:a.id,type:'FS 功能说明书'});
  const linked=await window.desk.saveTask({title:'确认审批异常规则',projectId:a.id,documentId:doc.id,priority:'high',dueDate:'2020-01-01',notes:'需要保留的备注'});
  const other=await window.desk.saveTask({title:'完成生产接口联调',projectId:b.id});
  const unassigned=await window.desk.saveTask({title:'整理今天的会议记录'});
  await window.desk.saveTask({title:'补充采购字段说明',projectId:a.id,status:'doing'});
  await window.desk.saveTask({title:'已确认接口范围',projectId:b.id,status:'done'});
  return{a,b,doc,linked,other,unassigned};
 });
 await waitFor(()=>document.querySelectorAll('.task-row').length===4);
 assert.equal(await page.getByLabel('当前项目',{exact:true}).count(),0,'Global tasks must not be inside a project');
 assert.equal(await page.locator('.task-group').count(),0,'Tasks are a flat list');
 assert.equal(await page.locator('.primary-nav').getByRole('button',{name:'待办',exact:true}).count(),1);
 assert.equal(await taskSelect('确认审批异常规则').inputValue(),ids.a.id);assert.equal(await taskSelect('完成生产接口联调').inputValue(),ids.b.id);
 await taskSelect('整理今天的会议记录').selectOption(ids.a.id);
 await waitFor(async arg=>(await window.desk.bootstrap()).tasks.find(t=>t.id===arg.id).project_id===arg.pid,{id:ids.unassigned.id,pid:ids.a.id});
 await taskSelect('整理今天的会议记录').selectOption(ids.b.id);
 await waitFor(async arg=>(await window.desk.bootstrap()).tasks.find(t=>t.id===arg.id).project_id===arg.pid,{id:ids.unassigned.id,pid:ids.b.id});
 await page.getByRole('button',{name:'项目 采购协同平台',exact:true}).click();await page.locator('.document-row').waitFor();
 await page.locator('.primary-nav').getByRole('button',{name:'待办',exact:true}).click();await waitFor(()=>document.querySelectorAll('.task-row').length===4);
 assert.equal(await page.getByLabel('按项目筛选待办').inputValue(),'');
 await page.getByLabel('快速添加待办').fill('核对交接清单');await page.getByLabel('快速添加待办').press('Enter');await taskSelect('核对交接清单').waitFor();assert.equal(await taskSelect('核对交接清单').inputValue(),'');
 await taskSelect('核对交接清单').selectOption(ids.b.id);await waitFor(async pid=>(await window.desk.bootstrap()).tasks.find(t=>t.title==='核对交接清单').project_id===pid,ids.b.id);
 await taskSelect('确认审批异常规则').selectOption(ids.b.id);let dialog=page.getByRole('dialog',{name:'更换待办项目'});await dialog.waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await taskSelect('确认审批异常规则').inputValue(),ids.a.id);
 await taskSelect('确认审批异常规则').selectOption(ids.b.id);dialog=page.getByRole('dialog',{name:'更换待办项目'});await dialog.getByRole('button',{name:'更换项目',exact:true}).click();
 await waitFor(async id=>(await window.desk.bootstrap()).tasks.find(t=>t.id===id).document_id===null,ids.linked.id);
 let state=await page.evaluate(()=>window.desk.bootstrap()),linked=state.tasks.find(t=>t.id===ids.linked.id);assert.equal(linked.project_id,ids.b.id);assert.equal(linked.notes,'需要保留的备注');assert.equal(linked.priority,'high');assert.equal(linked.due_date,'2020-01-01');assert.equal(state.documents.find(d=>d.id===ids.doc.id).project_id,ids.a.id);
 await page.getByLabel('按项目筛选待办').selectOption(ids.a.id);assert.equal(await page.locator('.task-row').count(),1);await page.getByLabel('按项目筛选待办').selectOption('');
 await page.getByLabel('按截止日期筛选').selectOption('overdue');assert.equal(await page.locator('.task-row').count(),1);await page.getByLabel('按截止日期筛选').selectOption('all');
 await page.locator(`[data-task-id="${ids.other.id}"]`).getByLabel('标记完成',{exact:true}).click();await waitFor(()=>document.querySelectorAll('.task-row').length===4);
 await page.locator('.segmented').getByRole('button',{name:'已完成',exact:true}).click();assert.equal(await page.locator('.task-row').count(),2);await taskSelect('完成生产接口联调').selectOption(ids.a.id);
 await waitFor(async arg=>{const t=(await window.desk.bootstrap()).tasks.find(t=>t.id===arg.id);return t.project_id===arg.pid&&t.status==='done';},{id:ids.other.id,pid:ids.a.id});
 await page.locator('.segmented').getByRole('button',{name:'未完成',exact:true}).click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.waitForTimeout(250);await page.screenshot({path:path.join(qa,'peer-tasks-window.png'),timeout:15000});
 await page.evaluate(()=>window.desk.setPresentation('edge'));await page.waitForFunction(()=>document.querySelector('.mode-edge'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
 await page.screenshot({path:path.join(qa,'peer-tasks-edge.png'),timeout:15000});
 await page.getByRole('tab',{name:/项目/}).click();await page.getByLabel('当前项目',{exact:true}).waitFor();await page.getByRole('tab',{name:/待办/}).click();await waitFor(()=>document.querySelectorAll('.task-row').length===4);
 await app.close();app=null;await launch();assert.equal(await page.getByLabel('当前项目',{exact:true}).count(),0);assert.equal(await page.getByLabel('按项目筛选待办').inputValue(),'');await waitFor(()=>document.querySelectorAll('.task-row').length===4);
 state=await page.evaluate(()=>window.desk.bootstrap());assert.equal(state.tasks.find(t=>t.id===ids.unassigned.id).project_id,ids.b.id);assert.deepEqual(errors,[]);
 console.log('PEER_TASKS_OK',JSON.stringify({dataDir,startupAllTasks:true,peerNavigation:true,inlineProject:true,linkedMoveConfirm:true,flatList:true,statusAndNotesPreserved:true,restart:true,narrowPanel:true}));await app.close();app=null;
}
run().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(qa,'peer-tasks-failure.png'),timeout:5000});}catch{}try{await app?.close();}catch{}process.exitCode=1;});
