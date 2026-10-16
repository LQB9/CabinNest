const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('./runtime.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa-ui'),dir=fs.mkdtempSync(path.join(qa,'files-'));
const env={...process.env,PROJECTDESK_DATA_DIR:dir,PROJECTDESK_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const messages=[];
async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'build-app')],env});page=await app.firstWindow();page.on('pageerror',e=>messages.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('UI_ERROR',m.text().slice(0,500));});await page.getByLabel('快速添加待办').waitFor();}
async function files(paths){await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},paths);}
async function run(){
 await launch();
 const folder=path.join(dir,'existing-folder');fs.mkdirSync(folder);fs.mkdirSync(path.join(folder,'nested'));fs.writeFileSync(path.join(folder,'FS_规则.txt'),'金额达到一万元时审批。');fs.writeFileSync(path.join(folder,'nested','重复FS.txt'),'金额达到一万元时审批。');fs.writeFileSync(path.join(folder,'技术交接.txt'),'部署需要先导入结构再导入程序。');fs.writeFileSync(path.join(folder,'ignore.exe'),'not executable');
 await files([folder]);const imported=await page.evaluate(()=>window.desk.chooseImport({mode:'folder'}));assert.equal(imported.imported,2);assert.equal(imported.duplicates,1);
 let state=await page.evaluate(()=>window.desk.bootstrap()),doc=state.documents.find(d=>d.title==='FS_规则');assert.equal(doc.type,'FS 功能说明书');
 await app.evaluate(({shell})=>{shell.openPath=async()=>'';});await page.evaluate(id=>window.desk.openFile(id),doc.id);
 const editDir=path.join(dir,'editing',doc.id),session=JSON.parse(fs.readFileSync(path.join(editDir,'session.json'),'utf8'));fs.writeFileSync(path.join(editDir,session.name),'外部编辑新增规则：需要二级审批。');
 const collected=await page.evaluate(id=>window.desk.collectEdit(id),doc.id);assert.equal(collected.unchanged,false);const versions=await page.evaluate(id=>window.desk.getDocument(id),doc.id);assert.equal(versions.versions.length,2);console.log('FILES_STAGE','folder-dedup-and-external-edit');
 const pdf=path.join(dir,'预览验证.pdf');const pdfBytes=await app.evaluate(async({BrowserWindow})=>Array.from(await BrowserWindow.getAllWindows()[0].webContents.printToPDF({printBackground:true})));fs.writeFileSync(pdf,Buffer.from(pdfBytes));
 await files([pdf]);const report=await page.evaluate(()=>window.desk.chooseImport({mode:'files'}));assert.equal(report.imported,1);
 await page.locator('.main-nav').getByRole('button',{name:'全部资料',exact:true}).click();await page.getByRole('button',{name:/预览验证/}).click();await page.locator('iframe[title="PDF 预览"]').waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.waitForTimeout(3500);
 const urls=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.mainFrame.framesInSubtree.map(f=>f.url));console.log('PDF_FRAMES',JSON.stringify(urls));assert.ok(urls.some(u=>u.startsWith('chrome-extension://')),'PDF viewer extension did not initialize');
 const image=await app.evaluate(async({BrowserWindow})=>Promise.race([BrowserWindow.getAllWindows()[0].webContents.capturePage().then(i=>i.toPNG().toString('base64')),new Promise(r=>setTimeout(()=>r(null),6000))]));if(image)fs.writeFileSync(path.join(qa,'pdf-preview.png'),Buffer.from(image,'base64'));
 await page.evaluate(()=>window.desk.createNote({title:'关闭即保存验证',type:'技术笔记'}));await page.getByRole('button',{name:'返回资料',exact:true}).click();await page.getByRole('button',{name:/关闭即保存验证/}).click();await page.locator('.document-editor').fill('窗口关闭前必须留存的正文。');
 const id=(await page.evaluate(()=>window.desk.bootstrap())).documents.find(d=>d.title==='关闭即保存验证').id;
 const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;
 await launch();const saved=await page.evaluate(id=>window.desk.getDocument(id),id);assert.match(saved.body_html,/必须留存/);assert.deepEqual(messages,[]);console.log('DESKTOP_FILES_OK',JSON.stringify({dir,folderImport:report.imported,externalVersions:versions.versions.length,closeFlush:true,pdf:true}));await app.close();app=null;
}
run().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(qa,'files-failure.png')});}catch{}try{await app?.close();}catch{}process.exitCode=1;});
