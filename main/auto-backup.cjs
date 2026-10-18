const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Worker}=require('node:worker_threads');
const {validateDirectory}=require('./backup-files.cjs');
function businessFingerprint(store){const hash=crypto.createHash('sha256');for(const table of ['projects','documents','versions','tasks','settings','requirements','document_requirements'])hash.update(JSON.stringify(store.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('编辑副本含有链接');if(e.isDirectory())walk(f);else{const s=fs.statSync(f);hash.update(JSON.stringify([path.relative(store.root,f),s.size,s.mtimeMs]));}}}walk(path.join(store.root,'editing'));return hash.digest('hex');}
class AutoBackup {
 constructor({store,onState=()=>{},onFailure=()=>{},isBusy=()=>false,clock=()=>Date.now(),perform}={}) {
  Object.assign(this,{store,onState,onFailure,isBusy,clock});this.file=path.join(store.root,'profile','auto-backup.json');
  this.running=false;this.exiting=false;this.disposed=false;this.worker=null;this.activeRun=null;this.lastCheckAt=null;this.alertedError=null;
  this.perform=perform||((job)=>new Promise((resolve,reject)=>{
   const worker=new Worker(path.join(__dirname,'backup-worker.cjs'),{workerData:job});this.worker=worker;let settled=false;
   worker.once('message',m=>{settled=true;m.error?reject(new Error(m.error)):resolve(m.result);});worker.once('error',reject);
   worker.once('exit',code=>{if(!settled)reject(new Error('备份进程提前结束：'+code));});
  }));
  let saved={};try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{}
  this.settings={ownerId:crypto.randomUUID(),enabled:false,directory:'',frequencyHours:24,keep:7,lastSuccessAt:null,lastFingerprint:null,lastPath:null,lastError:null,lastSummary:null,...saved};
  if(!/^[a-f0-9-]{36}$/i.test(this.settings.ownerId))this.settings.ownerId=crypto.randomUUID();
  if(![1,6,24].includes(this.settings.frequencyHours))this.settings.frequencyHours=24;
  if(!Number.isInteger(this.settings.keep)||this.settings.keep<3||this.settings.keep>30)this.settings.keep=7;
  this.settings.enabled=this.settings.enabled===true;
 }
 getState() {
  const {ownerId,lastFingerprint,...value}=this.settings;let nextCheckAt=null;
  if(value.enabled&&!this.exiting&&!this.running){const due=!value.lastError&&lastFingerprint&&value.lastSuccessAt?Date.parse(value.lastSuccessAt)+value.frequencyHours*3600000:0,retry=value.lastError&&value.lastErrorAt?Date.parse(value.lastErrorAt)+900000:0;nextCheckAt=new Date(Math.max(this.clock()+60000,due||0,retry||0)).toISOString();}
  return {...value,running:this.running,exiting:this.exiting,lastCheckAt:this.lastCheckAt,nextCheckAt};
 }
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temporary=this.file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(this.settings,null,2));fs.renameSync(temporary,this.file);}
 emit(){if(this.disposed)return;const state=this.getState();this.onState(state);if(!state.lastError)this.alertedError=null;else if(!this.running&&!this.exiting&&this.alertedError!==state.lastError){this.alertedError=state.lastError;this.onFailure(state);}}
 update(value){if(this.running||this.exiting)throw new Error('请等待当前备份完成');if(typeof value.enabled!=='boolean'||![1,6,24].includes(value.frequencyHours)||!Number.isInteger(value.keep)||value.keep<3||value.keep>30)throw new Error('自动备份配置无效');const directory=value.directory?validateDirectory(this.store.root,value.directory):'';if(value.enabled&&!directory)throw new Error('请先选择自动备份目录');if(directory!==this.settings.directory){this.settings.lastFingerprint=null;this.settings.lastPath=null;this.settings.lastSuccessAt=null;this.settings.lastSummary=null;this.settings.lastError=null;this.settings.lastErrorAt=null;}Object.assign(this.settings,{enabled:value.enabled,directory,frequencyHours:value.frequencyHours,keep:value.keep});this.save();this.emit();return this.getState();}
 start(){this.emit();this.timer=setInterval(()=>this.tick().catch(()=>{}),60000);this.timer.unref();this.startup=setTimeout(()=>this.tick().catch(()=>{}),5000);this.startup.unref();}
 async tick(){if(this.disposed||this.exiting||this.running||!this.settings.enabled||this.isBusy())return null;if(this.settings.lastErrorAt&&this.settings.lastError&&this.clock()-Date.parse(this.settings.lastErrorAt)<900000)return null;if(!this.settings.lastError&&this.settings.lastFingerprint&&this.settings.lastSuccessAt&&this.clock()-Date.parse(this.settings.lastSuccessAt)<this.settings.frequencyHours*3600000)return null;return this.run(false);}
 run(force=true){if(this.running)return Promise.reject(new Error('备份正在进行中'));const job=this.performRun(force);this.activeRun=job;return job.finally(()=>{if(this.activeRun===job)this.activeRun=null;});}
 async performRun(force){
  if(this.disposed)throw new Error('应用正在退出');if(this.isBusy())throw new Error('请等待当前导入或归档操作完成');if(!this.settings.directory)throw new Error('请先选择并保存备份目录');
  this.running=true;this.emit();
  try{
   const directory=validateDirectory(this.store.root,this.settings.directory),fingerprint=businessFingerprint(this.store);this.lastCheckAt=new Date(this.clock()).toISOString();
   if(!force&&fingerprint===this.settings.lastFingerprint&&this.settings.lastPath&&fs.existsSync(path.join(this.settings.lastPath,'manifest.json'))){if(this.settings.lastError){this.settings.lastError=null;this.settings.lastErrorAt=null;this.save();}return null;}
   const result=await this.perform({dataRoot:this.store.root,directory,ownerId:this.settings.ownerId,keep:this.settings.keep});
   if(!this.disposed){Object.assign(this.settings,{lastSuccessAt:new Date(this.clock()).toISOString(),lastFingerprint:fingerprint,lastPath:result.path,lastSummary:result.summary||null,lastError:null,lastErrorAt:null,warning:result.warnings?.length?'备份已完成，部分旧备份未能清理':null});this.save();}return result;
  }catch(e){if(!this.disposed){this.settings.lastError=e.message;this.settings.lastErrorAt=new Date(this.clock()).toISOString();this.save();}throw e;}
  finally{this.running=false;this.worker=null;this.emit();}
 }
 async beforeQuit(){
  this.exiting=true;this.emit();
  if(this.activeRun){try{await this.activeRun;}catch{}}
  if(this.settings.enabled)return this.run(false);
  return null;
 }
 cancelQuit(){this.exiting=false;this.emit();}
 dispose(){this.disposed=true;clearInterval(this.timer);clearTimeout(this.startup);this.worker?.terminate();}
}
module.exports={AutoBackup,businessFingerprint};
