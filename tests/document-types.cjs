const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {_electron}=require('./runtime.cjs'),{Document,Packer,Paragraph}=require('docx'),{projectWorkbook}=require('../main/project-workbook.cjs'),{fileDrag}=require('./drop-helpers.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa-ui');fs.mkdirSync(qa,{recursive:true});
const folder=fs.mkdtempSync(path.join(qa,'document-types-')),env={...process.env,PROJECTDESK_DATA_DIR:path.join(folder,'data'),PROJECTDESK_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[],digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function launch(){app=await _electron.launch({executablePath:process.env.PROJECTDESK_TEST_EXECUTABLE||require('electron'),args:process.env.PROJECTDESK_TEST_EXECUTABLE?[]:[path.join(root,'build-app')],env,timeout:40000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByLabel('快速添加待办').waitFor();await page.evaluate(()=>window.desk.setPresentation('window'));}
const row=id=>page.locator(`.document-row[data-document-id="${id}"]`);
const picker=id=>row(id).getByRole('combobox');
const storedHash=async id=>crypto.createHash('sha256').update(Buffer.from(await page.evaluate(async id=>Array.from((await window.desk.fileData(id)).data),id))).digest('hex');
async function expectType(id,type){await page.waitForFunction(async v=>(await window.desk.getDocument(v.id)).type===v.type,{id,type});await page.waitForFunction(v=>document.querySelector(`.document-row[data-document-id="${v.id}"] select`)?.value===v.type,{id,type});}
(async()=>{
 const word=path.join(folder,'采购审批功能说明书.docx'),technical=path.join(folder,'采购审批开发技术说明.docx'),excel=path.join(folder,'采购审批数据模板.xlsx');
 for(const file of [word,technical])fs.writeFileSync(file,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('独立测试用示例文档')]}]})));
 fs.writeFileSync(excel,await projectWorkbook({createdAt:new Date().toISOString(),project:{name:'示例字段',code:'',client:'',description:'',status:'进行中'},requirements:[],documents:[],versions:[],tasks:[],workingCopies:[]}));
 await launch();const ids=await page.evaluate(async()=>{const p=await window.desk.saveProject({name:'示例项目'}),r=await window.desk.saveRequirement({projectId:p.id,title:'采购审批',code:'REQ-001',status:'进行中'});return{p:p.id,r:r.id};});
 await page.locator(`.project-entry[data-project-id="${ids.p}"]`).click();const group=page.locator(`.requirement-group[data-requirement-id="${ids.r}"]`);await group.waitFor();
 const drag=await fileDrag(page,group,[word,technical,excel]);await drag.drop();await page.waitForFunction(()=>document.querySelectorAll('.document-row').length===3);
 let state=await page.evaluate(()=>window.desk.bootstrap());const docs={fs:state.documents.find(d=>d.title==='采购审批功能说明书'),tech:state.documents.find(d=>d.title==='采购审批开发技术说明'),excel:state.documents.find(d=>d.title==='采购审批数据模板')};
 await expectType(docs.fs.id,'FS 功能说明书');await expectType(docs.tech.id,'技术说明');await expectType(docs.excel.id,'其他资料');
 assert.deepEqual(await group.locator('.document-row').evaluateAll(nodes=>nodes.map(n=>n.dataset.documentId)),[docs.fs.id,docs.tech.id,docs.excel.id]);
 const colors=await Promise.all([picker(docs.fs.id),picker(docs.tech.id)].map(locator=>locator.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el.parentElement).backgroundColor}))));assert.notEqual(colors[0].color,colors[1].color);assert.notEqual(colors[0].background,colors[1].background);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='CabinNest').setContentSize(1180,780));await page.screenshot({path:path.join(qa,'document-types-window.png'),timeout:15000});
 const before=await page.evaluate(id=>window.desk.getDocument(id),docs.excel.id);await page.evaluate(id=>window.desk.saveTask({documentId:id,title:'核对示例字段'}),docs.excel.id);
 await picker(docs.excel.id).selectOption('技术设计');await expectType(docs.excel.id,'技术设计');assert.equal(await page.locator('.document-view').count(),0);const after=await page.evaluate(id=>window.desk.getDocument(id),docs.excel.id);assert.deepEqual(after.versions,before.versions);assert.equal(after.requirement.id,ids.r);assert.equal(after.tasks.length,1);assert.equal(await storedHash(docs.excel.id),digest(excel));
 await row(docs.excel.id).getByRole('checkbox').check();await picker(docs.excel.id).selectOption('其他资料');await expectType(docs.excel.id,'其他资料');assert.equal(await row(docs.excel.id).getByRole('checkbox').isChecked(),true);
 // The native selector remains keyboard accessible, without opening the document.
 await picker(docs.fs.id).focus();await page.keyboard.press('ArrowDown');await expectType(docs.fs.id,'技术说明');await picker(docs.fs.id).selectOption('FS 功能说明书');await expectType(docs.fs.id,'FS 功能说明书');
 await page.getByRole('button',{name:'全部文件',exact:true}).click();await picker(docs.excel.id).selectOption('技术设计');await expectType(docs.excel.id,'技术设计');
 await page.getByRole('button',{name:'全部资料',exact:true}).click();await row(docs.fs.id).waitFor();assert.equal(await picker(docs.fs.id).inputValue(),'FS 功能说明书');assert.equal(await picker(docs.excel.id).inputValue(),'技术设计');
 await page.locator(`.project-entry[data-project-id="${ids.p}"]`).click();await page.getByRole('button',{name:'按需求归类',exact:true}).click();
 for(const mode of ['edge','tray']){await page.evaluate(mode=>window.desk.setPresentation(mode),mode);await page.waitForFunction(mode=>document.querySelector('.mode-'+mode),mode);await row(docs.fs.id).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
  for(const id of [docs.fs.id,docs.tech.id,docs.excel.id])assert.ok(await row(id).evaluate(el=>{const bounds=el.getBoundingClientRect();return [...el.querySelectorAll('.document-type-picker,.document-title,.document-row-actions')].every(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.left>=bounds.left-1&&r.right<=bounds.right+1;});}));
  await page.screenshot({path:path.join(qa,`document-types-${mode}.png`),timeout:15000});
 }
 await app.close();app=null;await launch();await page.locator(`.project-entry[data-project-id="${ids.p}"]`).click();await expectType(docs.excel.id,'技术设计');assert.equal((await page.evaluate(id=>window.desk.getDocument(id),docs.fs.id)).requirement.id,ids.r);
 for(const [file,doc]of [[word,docs.fs],[technical,docs.tech],[excel,docs.excel]])assert.equal(await storedHash(doc.id),digest(file));
 assert.deepEqual(errors,[]);console.log('DOCUMENT_TYPES_UI_OK',JSON.stringify({diskDrag:true,autoTypes:true,visibleDistinctColors:true,typeOrdering:true,inlineChange:true,keyboard:true,selectionPreserved:true,threeModes:true,flatAndGlobal:true,restart:true,filesVersionsAndRelationsPreserved:true}));await app.close();app=null;
})().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(qa,'document-types-failure.png'),timeout:5000});}catch{}try{await app?.close();}catch{}process.exitCode=1;});
