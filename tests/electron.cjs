const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('./runtime.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa-ui');fs.mkdirSync(qa,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(qa,'run-'));let app,page;
const env={...process.env,PROJECTDESK_DATA_DIR:dataDir,PROJECTDESK_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
const failures=[];
async function launch(){
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'build-app')],env,timeout:40000});
 app.process().stderr.on('data',d=>{const s=String(d);if(/Error:|Exception|Cannot find|module/i.test(s))console.log('ELECTRON_STDERR',s.slice(0,1000));});
 page=await app.firstWindow();page.on('pageerror',e=>failures.push(e.message));
 page.on('console',m=>{if(m.type()==='error')console.log('RENDERER_ERROR',m.text().slice(0,700));});
 await page.getByLabel('快速添加待办').waitFor({timeout:30000});
}
async function dialogReturn(paths){await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},paths);}
async function waitState(fn,arg){const until=Date.now()+30000;while(Date.now()<until){if(await page.evaluate(fn,arg))return;await new Promise(r=>setTimeout(r,70));}throw new Error('State condition timed out');}
async function run(){
 await launch();assert.equal(await page.evaluate(()=>typeof require),'undefined');
 console.log('E2E_STAGE','window-ready');
 await page.getByRole('button',{name:'新建项目',exact:true}).click();
 let modal=page.getByRole('dialog');await modal.getByLabel('项目名称 *').fill('采购协同项目（测试）');await modal.getByLabel('项目编号').fill('PRJ-QA');await modal.getByLabel('客户 / 业务方').fill('测试业务组');await modal.getByRole('button',{name:'保存项目',exact:true}).click();
 await waitState(async()=>{const d=await window.desk.bootstrap();return d.projects.length===1;});
 await page.getByRole('button',{name:'新建资料',exact:true}).click();modal=page.getByRole('dialog');await modal.getByLabel('资料标题 *').fill('采购审批功能说明');await modal.getByRole('button',{name:'创建并编辑',exact:true}).click();
 await page.locator('.document-editor').waitFor();assert.ok(await page.locator('.document-editor table').count()>=4);
 const editor=page.locator('.document-editor');await editor.click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.insertText('集成验证：采购金额超过一万元时增加审批。');await page.keyboard.press('Control+s');
 await waitState(async()=>{const d=await window.desk.bootstrap();const n=await window.desk.getDocument(d.documents[0].id);return n.body_html.includes('集成验证');});
 let state=await page.evaluate(()=>window.desk.bootstrap()),noteId=state.documents[0].id;
 console.log('E2E_STAGE','editor-and-save');
 await page.getByRole('button',{name:'关联待办',exact:true}).click();modal=page.getByRole('dialog');await modal.getByLabel('待办内容 *').fill('确认采购金额审批规则');await modal.getByLabel('截止日期').fill('2000-01-01');await modal.getByRole('button',{name:'保存待办',exact:true}).click();await page.getByRole('button',{name:'资料信息与版本',exact:true}).click();await page.locator('.linked-task').getByText('确认采购金额审批规则').waitFor();
 await page.getByRole('button',{name:'保存快照',exact:true}).click();modal=page.getByRole('dialog');await modal.getByLabel('版本说明').fill('v1.1 已确认规则');await modal.getByRole('button',{name:'保存快照',exact:true}).click();await modal.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'待办',exact:true}).first().click();await page.getByLabel('快速添加待办').waitFor();await page.getByRole('button',{name:'标记完成',exact:true}).click();await page.getByRole('button',{name:'已完成',exact:true}).click();await page.locator('.task-content').getByText('确认采购金额审批规则',{exact:true}).waitFor();
 await page.locator('.sidebar-global').getByRole('button',{name:'全部资料',exact:true}).click();await page.getByRole('button',{name:'收藏资料',exact:true}).last().click();await page.locator('.main-nav').getByRole('button',{name:'收藏资料',exact:true}).click();await page.getByRole('button',{name:/采购审批功能说明/}).waitFor();
 await page.getByRole('button',{name:/采购审批功能说明/}).click();await page.locator('.document-editor').waitFor();
 const exported=path.join(dataDir,'FS导出验证.docx');await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:p});},exported);await page.getByRole('button',{name:'导出 Word',exact:true}).click();
 await waitState(()=>document.querySelector('.toast')?.textContent.includes('已导出'));
 assert.ok(fs.statSync(exported).size>1000);
 console.log('E2E_STAGE','word-export');
 await page.getByRole('button',{name:'返回资料',exact:true}).click();await page.getByRole('button',{name:'导入资料',exact:true}).click();await dialogReturn([exported]);modal=page.getByRole('dialog');await modal.getByRole('button',{name:'选择文件',exact:true}).click();
 await waitState(async()=>{const d=await window.desk.bootstrap();return d.documents.some(x=>x.kind==='file');});
 state=await page.evaluate(()=>window.desk.bootstrap());const fileDoc=state.documents.find(d=>d.kind==='file');
 await page.getByRole('button',{name:new RegExp(fileDoc.title)}).click();await page.locator('iframe[title="Word 文档预览"]').waitFor();
 const docFrame=page.frameLocator('iframe[title="Word 文档预览"]');await docFrame.locator('section.docx').first().waitFor({timeout:45000});assert.ok((await docFrame.locator('#document-container').textContent()).includes('采购'));assert.equal(await docFrame.locator('body').evaluate(()=>typeof window.desk),'undefined');
 await page.screenshot({path:path.join(qa,'word-preview.png')});
 console.log('E2E_STAGE','word-preview');
 const payload=await page.evaluate(async id=>{const f=await window.desk.fileData(id);return{bytes:f.data.length,ext:f.ext};},fileDoc.id);assert.equal(payload.ext,'.docx');assert.ok(payload.bytes>1000);
 await page.getByRole('button',{name:'返回资料',exact:true}).click();await page.getByLabel('搜索资料').fill('集成验证');await waitState(()=>document.querySelectorAll('.document-row').length>=1);await page.getByLabel('清空搜索').click();
 await page.getByRole('button',{name:/备份与设置/}).click();const backupDest=path.join(dataDir,'chosen-backups');fs.mkdirSync(backupDest);await dialogReturn([backupDest]);await page.getByRole('button',{name:'创建完整备份',exact:true}).click();await waitState(()=>document.querySelector('.toast')?.textContent.includes('备份已保存'));
 const backup=path.join(backupDest,fs.readdirSync(backupDest)[0]);assert.ok(fs.existsSync(path.join(backup,'manifest.json')));
 await page.evaluate(()=>window.desk.saveProject({name:'恢复前临时项目'}));await dialogReturn([backup]);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await page.getByRole('button',{name:'从备份恢复',exact:true}).click();await waitState(async()=>!(await window.desk.bootstrap()).projects.some(p=>p.name==='恢复前临时项目'));
 await page.locator('.sidebar-global').getByRole('button',{name:'全部资料',exact:true}).click();await page.getByLabel('搜索资料',{exact:true}).waitFor();await page.screenshot({path:path.join(qa,'workbench.png')});
 assert.deepEqual(failures,[]);
 await app.close();app=null;
 await launch();state=await page.evaluate(()=>window.desk.bootstrap());assert.equal(state.projects.length,1);assert.equal(state.documents.length,2);assert.equal(state.tasks[0].status,'done');const saved=await page.evaluate(id=>window.desk.getDocument(id),noteId);assert.match(saved.body_html,/集成验证/);
 console.log('E2E_OK',JSON.stringify({dataDir,projects:state.projects.length,documents:state.documents.length,tasks:state.tasks.length,exported,screenshots:qa}));
 await app.close();app=null;
}
run().catch(async e=>{console.error(e);try{if(page)await page.screenshot({path:path.join(qa,'failure.png')});}catch{}try{await app?.close();}catch{}process.exitCode=1;});
