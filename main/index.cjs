const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const { Worker }=require('node:worker_threads');
const {spawn}=require('node:child_process');
const {Store,within}=require('./store.cjs');
const {createPresentation}=require('./presentation.cjs');
const {exportDocx}=require('./export-docx.cjs');
const {exportProject,importProject,readArchive}=require('./project-archive.cjs');
const {ImportPlans}=require('./import-plans.cjs');
const {AutoBackup}=require('./auto-backup.cjs');
const {ProjectRetirement}=require('./project-retirement.cjs');
const {resolveDataRoot,legacyDataRoots,isInstalled}=require('./data-location.cjs');
const {migrateInstalledData}=require('./data-migration.cjs');
const dataOptions={override:process.env.PROJECTDESK_DATA_DIR,isPackaged:app.isPackaged,executable:process.execPath,sourceRoot:path.join(__dirname,'..'),markerPath:path.join(__dirname,'../install-mode.json'),localAppData:process.env.LOCALAPPDATA,homeDirectory:app.getPath('home')};
const dataRoot=resolveDataRoot(dataOptions);
// Keep the single-instance lock outside the data directory while it is migrated.
const lockRoot=!dataOptions.override&&isInstalled(dataOptions)?path.join(path.dirname(dataRoot),'instance'):path.join(dataRoot,'profile');
fs.mkdirSync(lockRoot,{recursive:true});app.setPath('userData',lockRoot);
app.setName('CabinNest');if(process.platform==='win32')app.setAppUserModelId('CabinNest');
let win,store,presentation,importPlans,autoBackup,retirement,allowClose=false,closeTimer,closeAction=null,quitFinishing=false,nativeDialogDepth=0,indexing=false,archiveBusy=false,importBusy=false,archiveChoice=null;const queue=[];const queued=new Set();
const isTest=process.env.PROJECTDESK_TEST==='1';
const primaryInstance=app.requestSingleInstanceLock();if(!primaryInstance)app.quit();
let migrationError;
if(primaryInstance)try{migrateInstalledData({target:dataRoot,candidates:legacyDataRoots(dataOptions)});}catch(error){migrationError=error;}
fs.mkdirSync(dataRoot,{recursive:true});app.setPath('userData',path.join(dataRoot,'profile'));
app.setPath('crashDumps',path.join(dataRoot,'profile','crash-dumps'));
app.on('second-instance',(_event,commandLine)=>{if(commandLine.includes('--quit-for-update'))requestClose('quit');else presentation?.show();});
function requestClose(action='hide'){
 if(archiveBusy||importBusy||nativeDialogDepth){if(win&&!win.isDestroyed()){win.show();win.focus();}return;}
 if(!win||win.isDestroyed()||closeAction==='quit')return;
 closeAction=action;win.webContents.send('desk:request-save');clearTimeout(closeTimer);
 closeTimer=setTimeout(()=>{closeAction=null;win.show();dialog.showMessageBox(win,{type:'warning',message:'资料尚未保存完成，请稍后重试。'});},15000);
}
async function finishQuit(){
 if(quitFinishing)return;quitFinishing=true;
 try{
 while(win&&!win.isDestroyed()){
  try{await autoBackup.beforeQuit();allowClose=true;closeAction=null;presentation?.dispose();win.close();return;}
  catch(error){
   presentation?.show();nativeDialogDepth++;
   let answer;try{answer=await dialog.showMessageBox(win,{type:'warning',title:'退出前备份未完成',message:'最新修改尚未完成自动备份。',detail:error.message+'\n本机资料仍保留。可以重试，返回应用处理，或保留本机资料并退出。',buttons:['重试备份','返回应用','仍然退出'],defaultId:1,cancelId:1});}finally{nativeDialogDepth--;}
   if(answer.response===0)continue;
   if(answer.response===2){allowClose=true;closeAction=null;presentation?.dispose();win.close();return;}
   closeAction=null;autoBackup.cancelQuit();return;
  }
 }
 }finally{quitFinishing=false;}
}
function changed(){if(win&&!win.isDestroyed())win.webContents.send('desk:changed');}
function addIndex(job){if(!job?.versionId||queued.has(job.versionId))return;queued.add(job.versionId);queue.push({...job,generation:store.generation});runIndex();}
async function runIndex(){
 if(indexing||!queue.length)return;indexing=true;const job=queue.shift();
 try{
  const result=await new Promise((resolve,reject)=>{
   const worker=new Worker(path.join(__dirname,'extract-worker.cjs'),{workerData:{filename:job.path,ext:job.ext},resourceLimits:{maxOldGenerationSizeMb:512}});
   const timer=setTimeout(()=>{worker.terminate();reject(new Error('正文索引超时'));},90000);
   worker.once('message',r=>{clearTimeout(timer);resolve(r);});worker.once('error',e=>{clearTimeout(timer);reject(e);});
   worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new Error('索引进程已结束'));}});
  });
  if(job.generation===store.generation)store.setIndex(job.versionId,result.text,result.state);
 }catch(e){if(job.generation===store.generation)store.setIndex(job.versionId,'','failed');}
 finally{queued.delete(job.versionId);indexing=false;changed();runIndex();}
}
function resumeIndexes(){for(const j of store.pendingIndexes())addIndex(j);}
const writesDuringQuit=new Set(['desk:save-project','desk:save-requirement','desk:assign-requirement','desk:create-note','desk:update-document','desk:save-task','desk:trash','desk:import','desk:import-dropped','desk:resolve-import','desk:snapshot','desk:restore-version','desk:open-file','desk:collect-edit','desk:restore-backup','desk:import-project-archive','desk:retire-project','desk:remove-retired-project']);
function secureHandle(channel,fn){ipcMain.handle(channel,async(event,...args)=>{if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('无效的应用请求');if(autoBackup?.exiting&&writesDuringQuit.has(channel))throw new Error('正在完成退出前备份，请稍候');if(archiveBusy&&writesDuringQuit.has(channel))throw new Error('正在归档或导入项目，请等待完成');const nativeDialog=['desk:import','desk:import-dropped','desk:export-document','desk:backup','desk:restore-backup','desk:export-project','desk:choose-project-archive','desk:import-project-archive','desk:choose-backup-directory'].includes(channel);if(nativeDialog)nativeDialogDepth++;try{return await fn(...args);}finally{if(nativeDialog)nativeDialogDepth--;}});}
const supported=new Set(['.docx','.doc','.pdf','.xlsx','.xls','.pptx','.ppt','.txt','.md','.csv','.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg','.zip','.rar','.7z','.nugg','.abap','.sql','.json','.xml','.sh','.html','.htm','.log','.rtf']);
function scanFolder(dir){const files=[];let limit=false;function walk(current){for(const entry of fs.readdirSync(current,{withFileTypes:true})){if(files.length>=2000){limit=true;return;}const p=path.join(current,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){if(!entry.name.startsWith('.')&&!['node_modules','__pycache__'].includes(entry.name))walk(p);}else if(entry.isFile()&&supported.has(path.extname(p).toLowerCase())&&!entry.name.startsWith('~$'))files.push(p);}}walk(dir);return{files,limit};}
async function importDialog(input={}){
 const folder=input.mode==='folder';const result=await dialog.showOpenDialog(win,{title:input.documentId?'选择新版本文件':folder?'选择要导入的资料文件夹':'选择项目资料',properties:folder?['openDirectory']:['openFile',...(input.documentId?[]:['multiSelections'])]});
 if(result.canceled)return null;
 const selection=folder?scanFolder(result.filePaths[0]):{files:result.filePaths,limit:false};
 return importSelection(selection,input);
}
async function importSelection(selection,input,steps){
 if(importBusy||archiveBusy)throw new Error('请等待当前导入或归档操作完成');
 const project=store.assertProject(input.projectId);if(!input.documentId)store.assertRequirement(input.requirementId,project);
 if(!steps){const plan=importPlans.prepare(selection,input);if(plan)return plan;}
 const report={imported:0,updated:0,skipped:0,duplicates:0,linked:0,errors:[],limit:selection.limit,ids:[]};
 importBusy=true;
 try{for(const step of steps||selection.files.map(source=>({source}))){const {source}=step;if(step.skip){report.skipped++;continue;}try{const documentId=step.documentId||input.documentId||undefined,r=store.importFile(source,{projectId:input.projectId||null,type:input.type||undefined,documentId,requirementId:input.requirementId||undefined});if(r.duplicate){report.duplicates++;if(r.linked)report.linked++;}else{report.imported++;if(documentId)report.updated++;report.ids.push(r.id);addIndex(r);}}catch(e){report.errors.push({file:path.basename(source),message:e.message});}await new Promise(r=>setImmediate(r));}return report;}
 finally{importBusy=false;changed();}
}
function importDropped(input={}){
 if(!input||!Array.isArray(input.paths)||!input.paths.length||input.paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('请拖入有效的本地文件');
 if(!input.projectId||!input.requirementId)throw new Error('请把文件拖到具体需求区域');
 return importSelection({files:[...new Set(input.paths)].slice(0,2000),limit:input.paths.length>2000},{projectId:input.projectId,requirementId:input.requirementId});
}
function workingSession(id){
 const dir=within(dataRoot,path.join(dataRoot,'editing',id)),meta=path.join(dir,'session.json');
 if(!fs.existsSync(meta))return null;const s=JSON.parse(fs.readFileSync(meta,'utf8'));s.path=within(dir,path.join(dir,s.name));return fs.existsSync(s.path)?s:null;
}
function document(id){const doc=store.getDocument(id);doc.workingCopy=!!workingSession(id);return doc;}
async function openWorkingCopy(id){
 const file=store.file(id);const dir=within(dataRoot,path.join(dataRoot,'editing',id));fs.mkdirSync(dir,{recursive:true});
 let session=workingSession(id);
 if(!session){const name=path.basename(file.file_name),dest=within(dir,path.join(dir,name));fs.copyFileSync(file.path,dest);session={name,versionId:file.id,baselineHash:file.sha256,path:dest};fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify(session));}
 const ext=path.extname(session.path).toLowerCase();
 if(['.docx','.doc','.pdf','.xlsx','.xls','.ppt','.pptx','.txt','.csv','.rtf','.png','.jpg','.jpeg','.gif','.bmp','.webp'].includes(ext)){
  const error=await shell.openPath(session.path);if(error)throw new Error(error);
 }else if(['.md','.abap','.sql','.json','.xml','.sh','.log','.html','.htm','.svg'].includes(ext))spawn('notepad.exe',[session.path],{windowsHide:false,detached:true,stdio:'ignore'}).unref();
 else shell.showItemInFolder(session.path);
 changed();return true;
}
function register(){
 secureHandle('desk:bootstrap',()=>({...store.bootstrap(),projectArchives:retirement.list()}));secureHandle('desk:search',f=>store.listDocuments(f));
 secureHandle('desk:get-document',id=>document(id));
 secureHandle('desk:save-project',v=>{const r=store.saveProject(v);changed();return r;});
 secureHandle('desk:save-requirement',v=>{const r=store.saveRequirement(v);changed();return r;});
 secureHandle('desk:assign-requirement',(ids,id)=>{const r=store.assignRequirement(ids,id);changed();return r;});
 secureHandle('desk:create-note',v=>{const r=store.createNote(v);changed();return r;});
 secureHandle('desk:update-document',v=>{const r=store.updateDocument(v);return r;});
 secureHandle('desk:save-task',v=>{const r=store.saveTask(v);changed();return r;});
 secureHandle('desk:trash',(kind,id,restore)=>{store.trash(kind,id,restore);changed();return true;});
 secureHandle('desk:import',importDialog);
 secureHandle('desk:import-dropped',importDropped);
 secureHandle('desk:resolve-import',async(token,choices)=>{if(importBusy||archiveBusy)throw new Error('请等待当前导入完成');const p=importPlans.resolve(token,choices);return importSelection(p.selection,p.input,p.steps);});
 secureHandle('desk:cancel-import',token=>importPlans.cancel(token));
 secureHandle('desk:get-auto-backup',()=>autoBackup.getState());
 secureHandle('desk:choose-backup-directory',async()=>{const result=await dialog.showOpenDialog(win,{title:'选择自动备份位置（也可选择云盘客户端的同步目录）',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];});
 secureHandle('desk:set-auto-backup',value=>{const state=autoBackup.update(value);setImmediate(()=>autoBackup.tick().catch(()=>{}));return state;});
 secureHandle('desk:run-auto-backup',()=>autoBackup.run());
 secureHandle('desk:reveal-auto-backup',()=>{const target=autoBackup.getState().lastPath;if(!target||!fs.existsSync(target))throw new Error('最近备份已被移动或删除，请点击立即备份重新创建');shell.showItemInFolder(target);return true;});
 secureHandle('desk:snapshot',(id,label)=>{const r=store.snapshot(id,label);changed();return r;});
 secureHandle('desk:restore-version',(id,versionId)=>{const r=store.restoreVersion(id,versionId);resumeIndexes();changed();return r;});
 secureHandle('desk:file-data',(id,versionId)=>{const f=store.file(id,versionId);return{data:fs.readFileSync(f.path),ext:f.ext,name:f.file_name};});
 secureHandle('desk:file-url',(id,versionId)=>pathToFileURL(store.file(id,versionId).path).href);
 secureHandle('desk:viewer-html',()=>fs.readFileSync(path.join(__dirname,'../renderer/docx-frame.html'),'utf8'));
 secureHandle('desk:open-file',openWorkingCopy);
 secureHandle('desk:collect-edit',id=>{
  const s=workingSession(id);if(!s)throw new Error('没有外部编辑副本');
  const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(s.path)).digest('hex');
  if(hash===s.baselineHash)return{unchanged:true};
  const r=store.importFile(s.path,{documentId:id});addIndex(r);
  s.versionId=r.versionId;s.baselineHash=hash;fs.writeFileSync(path.join(path.dirname(s.path),'session.json'),JSON.stringify(s));changed();return{unchanged:false};
 });
 secureHandle('desk:export-document',async id=>{
  const d=store.getDocument(id),ext=d.kind==='note'?'.docx':store.file(id).ext;
  const result=await dialog.showSaveDialog(win,{title:'导出资料',defaultPath:d.title.replace(/[<>:"/\\|?*]/g,' ')+ext});if(result.canceled)return null;
  if(d.kind==='note')fs.writeFileSync(result.filePath,await exportDocx(d.body_html,d.title));else fs.copyFileSync(store.file(id).path,result.filePath);return result.filePath;
 });
 const archiveProgress=progress=>{if(win&&!win.isDestroyed())win.webContents.send('desk:archive-progress',progress);};
 secureHandle('desk:retire-project',async id=>{
  if(archiveBusy||importBusy||autoBackup.running)throw new Error('请等待当前导入或备份完成');store.project(id);nativeDialogDepth++;
  let result;try{result=await dialog.showOpenDialog(win,{title:'选择永久归档位置，将创建“历史项目”文件夹',defaultPath:autoBackup.getState().directory||undefined,properties:['openDirectory','createDirectory']});}finally{nativeDialogDepth--;}
  if(result.canceled)return null;archiveBusy=true;try{const record=await retirement.create(id,result.filePaths[0],archiveProgress);changed();return record;}finally{archiveBusy=false;}
 });
 secureHandle('desk:remove-retired-project',async(id,confirmation)=>{if(archiveBusy||importBusy||autoBackup.running)throw new Error('请等待当前导入或备份完成');archiveBusy=true;try{const result=await retirement.removeLocal(id,confirmation,archiveProgress);changed();return result;}finally{archiveBusy=false;}});
 secureHandle('desk:preview-retired-project',id=>{const record=retirement.record(id),{summary}=readArchive(record.path),token=require('node:crypto').randomUUID();archiveChoice={folder:record.path,token};return{...summary,token};});
 secureHandle('desk:export-project',async id=>{
  if(archiveBusy)throw new Error('请等待当前项目归档操作完成');store.project(id);
  const result=await dialog.showOpenDialog(win,{title:'选择项目归档的保存位置（可选择 Google 云盘同步目录）',properties:['openDirectory','createDirectory']});if(result.canceled)return null;
  archiveBusy=true;try{return await exportProject(store,id,result.filePaths[0],archiveProgress);}finally{archiveBusy=false;}
 });
 secureHandle('desk:choose-project-archive',async()=>{
  if(archiveBusy)throw new Error('请等待当前项目归档操作完成');const result=await dialog.showOpenDialog(win,{title:'选择包含“项目归档.json”的归档文件夹',properties:['openDirectory']});if(result.canceled)return null;
  const {summary}=readArchive(result.filePaths[0]),token=require('node:crypto').randomUUID();archiveChoice={folder:result.filePaths[0],token};return{...summary,token};
 });
 secureHandle('desk:import-project-archive',async token=>{
  if(archiveBusy)throw new Error('请等待当前项目归档操作完成');if(!archiveChoice||archiveChoice.token!==token)throw new Error('请重新选择项目归档文件夹');
  archiveBusy=true;try{const result=await importProject(store,archiveChoice.folder,archiveProgress);archiveChoice=null;resumeIndexes();changed();return result;}finally{archiveBusy=false;}
 });
 secureHandle('desk:reveal-project-archive',folder=>{if(typeof folder!=='string'||!fs.existsSync(path.join(folder,'项目归档.json')))throw new Error('归档目录不存在');return shell.openPath(folder);});
 secureHandle('desk:backup',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择存放完整备份的位置',properties:['openDirectory','createDirectory']});if(r.canceled)return null;return store.backup(r.filePaths[0]);});
 secureHandle('desk:restore-backup',async()=>{
  if(autoBackup.running)throw new Error('请等待自动备份完成后再恢复');
  const r=await dialog.showOpenDialog(win,{title:'选择含有 manifest.json 的备份文件夹',properties:['openDirectory']});if(r.canceled)return null;
  const answer=await dialog.showMessageBox(win,{type:'question',buttons:['取消','恢复备份'],defaultId:0,cancelId:0,title:'恢复完整备份',message:'恢复后将使用备份中的项目、资料和待办。',detail:'当前资料会先自动备份到数据目录下的 backups 文件夹。'});if(answer.response!==1)return null;
  if(autoBackup.running)throw new Error('请等待自动备份完成后再恢复');const restored=store.restoreBackup(r.filePaths[0]);resumeIndexes();changed();return restored;
 });
 secureHandle('desk:reveal-data',()=>shell.openPath(dataRoot));
 secureHandle('desk:get-presentation',()=>presentation.getState());
 secureHandle('desk:set-presentation',mode=>presentation.setMode(mode));
 secureHandle('desk:set-handle-preferences',value=>presentation.setHandlePreferences(value));
 secureHandle('desk:collapse',()=>{presentation.collapse();return presentation.getState();});
 secureHandle('desk:window-action',action=>presentation.action(action));
 ipcMain.on('desk:expand-panel',event=>{if(presentation?.isHandleSender(event))presentation.show();});
 ipcMain.handle('desk:get-handle-state',event=>{if(!presentation?.isHandleSender(event))throw new Error('无效的悬浮入口请求');return presentation.getHandleState();});
 ipcMain.on('desk:handle-activity',(event,value)=>{if(presentation?.isHandleSender(event))presentation.handleActivity(value);});
 ipcMain.handle('desk:begin-handle-drag',event=>{if(!presentation?.isHandleSender(event))throw new Error('无效的悬浮入口请求');return presentation.beginHandleDrag();});
 ipcMain.on('desk:move-handle-drag',event=>{if(presentation?.isHandleSender(event))presentation.moveHandleDrag();});
 ipcMain.handle('desk:end-handle-drag',event=>{if(!presentation?.isHandleSender(event))throw new Error('无效的悬浮入口请求');return presentation.endHandleDrag();});
 ipcMain.on('desk:ready-close',e=>{if(e.sender===win?.webContents){clearTimeout(closeTimer);const action=closeAction;if(action==='quit'){finishQuit().catch(error=>{closeAction=null;autoBackup.cancelQuit();presentation?.show();dialog.showErrorBox('退出未完成',error.message);});}else{closeAction=null;presentation?.hide();}}});
 ipcMain.on('desk:cancel-close',e=>{if(e.sender===win?.webContents){clearTimeout(closeTimer);closeAction=null;presentation?.show();dialog.showMessageBox(win,{type:'error',message:'笔记保存未完成，请重试后再关闭。'});}});
}
app.whenReady().then(()=>{
 if(!primaryInstance)return;if(migrationError)throw migrationError;store=new Store(dataRoot);importPlans=new ImportPlans(store);retirement=new ProjectRetirement(store);Menu.setApplicationMenu(null);
 win=new BrowserWindow({width:980,height:680,minWidth:780,minHeight:540,frame:false,title:'CabinNest',backgroundColor:'#ffffff',show:false,icon:path.join(__dirname,'../assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,spellcheck:false,backgroundThrottling:false}});
 presentation=createPresentation({win,dataRoot,isTest,requestClose});
 autoBackup=new AutoBackup({store,isBusy:()=>archiveBusy||importBusy||nativeDialogDepth>0,onState:state=>{presentation?.setBackupState(state);if(win&&!win.isDestroyed())win.webContents.send('desk:auto-backup',state);},onFailure:state=>presentation?.alertBackupFailure(state)});autoBackup.start();
 register();win.loadFile(path.join(__dirname,'../renderer/index.html'));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(url!==win.webContents.getURL())event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 win.on('close',event=>{if(allowClose)return;event.preventDefault();requestClose(isTest?'quit':'hide');});
 win.on('blur',()=>{if(isTest)return;setTimeout(()=>{if(win&&!win.isDestroyed()&&!win.isMinimized()&&presentation.getState().mode==='tray'&&win.isVisible()&&!win.isFocused()&&!nativeDialogDepth)requestClose('hide');},180);});
 win.on('closed',()=>{win=null;});resumeIndexes();
}).catch(error=>{dialog.showErrorBox('CabinNest无法启动',error.message+'\n数据目录：'+dataRoot);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(win&&!allowClose){event.preventDefault();requestClose('quit');return;}autoBackup?.dispose();presentation?.dispose();try{store?.close();}catch{}});
