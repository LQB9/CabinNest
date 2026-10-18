// Read-only smoke check against a deliberately selected, populated installed library.
// Run with PROJECTDESK_TEST_EXECUTABLE and PROJECTDESK_EXPECT_DATA_ROOT explicitly set.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{_electron}=require('./runtime.cjs');
const executable=process.env.PROJECTDESK_TEST_EXECUTABLE,root=process.env.PROJECTDESK_EXPECT_DATA_ROOT;
if(!executable||!root)throw new Error('请明确指定安装版程序和要核对的资料目录');
const db=new DatabaseSync(path.join(root,'projectdesk.sqlite'),{readOnly:true});
let expected;try{expected={projects:db.prepare('SELECT count(*) n FROM projects').get().n,requirements:db.prepare('SELECT count(*) n FROM requirements').get().n,documents:db.prepare('SELECT count(*) n FROM documents WHERE deleted_at IS NULL').get().n};}finally{db.close();}
assert.ok(expected.projects>0,'检查应使用已有项目的资料库');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.PROJECTDESK_DATA_DIR;delete env.PROJECTDESK_TEST;
(async()=>{let app;try{for(let round=0;round<3;round++){
 app=await _electron.launch({executablePath:executable,args:[],env,timeout:30000});const page=await app.firstWindow();await page.getByRole('navigation',{name:'主导航',exact:true}).waitFor();
 const state=await page.evaluate(async()=>{const b=await window.desk.bootstrap();return{projects:b.projects.length,requirements:b.requirements.length,documents:b.documents.length,root:b.info.dataDir,version:b.info.version};});
 assert.deepEqual({projects:state.projects,requirements:state.requirements,documents:state.documents},expected);assert.equal(path.resolve(state.root).toLowerCase(),path.resolve(root).toLowerCase());assert.equal(fs.realpathSync.native(state.root).toLowerCase(),path.resolve(root).toLowerCase());
 await page.waitForFunction(n=>document.querySelectorAll('.project-entry').length===n,expected.projects);
 const exited=new Promise(resolve=>app.process().once('exit',resolve));
 // This IPC invokes the same requestClose('quit') used by the tray's Exit entry.
 await page.evaluate(()=>{setTimeout(()=>window.desk.windowAction('quit'),0);});
 await Promise.race([exited,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('托盘退出流程未完成')),30000);timeout.unref();})]);app=null;
 console.log('INSTALLED_RESTART_OK',JSON.stringify({round:round+1,...expected,version:state.version}));
 }}finally{if(app)await app.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
