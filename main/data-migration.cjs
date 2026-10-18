const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const TABLES=['projects','requirements','documents','versions','tasks','settings','document_requirements'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function noLinks(folder){
 if(fs.lstatSync(folder).isSymbolicLink())throw new Error('旧资料目录含有链接，请先手动迁移');
 for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('旧资料目录含有链接，请先手动迁移');if(entry.isDirectory())noLinks(file);}
}
function inspectLibrary(root){
 const db=new DatabaseSync(path.join(root,'projectdesk.sqlite'),{readOnly:true});
 try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('旧资料库校验失败，原目录已保留');
  const tables={},files={};
  for(const table of TABLES){const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);tables[table]=exists?db.prepare('SELECT * FROM '+table+' ORDER BY 1').all():[];}
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'").get())throw new Error('旧资料库格式无效');
  for(const name of ['files','editing']){
   const folder=path.join(root,name);if(!fs.existsSync(folder))continue;noLinks(folder);
   const walk=current=>{for(const entry of fs.readdirSync(current,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(current,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile())files[path.relative(root,file)]=hash(fs.readFileSync(file));}};walk(folder);
  }
  for(const version of tables.versions)if(version.store_name){const file=path.resolve(root,version.store_name),relative=path.relative(root,file);if(!file.startsWith(path.join(root,'files')+path.sep)||!files[relative]||version.sha256&&files[relative]!==version.sha256)throw new Error('旧资料附件缺失或校验失败，原目录已保留');}
  const nonempty=TABLES.some(table=>tables[table].length)||Object.keys(files).length>0;
  return{fingerprint:hash(JSON.stringify({tables,files})),nonempty,tables,files};
 }finally{db.close();}
}
function migrateInstalledData({target,candidates=[]}){
 target=path.resolve(target);const database=path.join(target,'projectdesk.sqlite');
 // Once a library exists here, it is authoritative, including an intentionally empty one.
 if(fs.existsSync(database))return{migrated:false};
 const libraries=[],seen=new Set();
 for(const candidate of candidates){
  if(!fs.existsSync(path.join(candidate,'projectdesk.sqlite')))continue;
  const root=fs.realpathSync.native(candidate),key=root.toLowerCase();if(seen.has(key)||key===target.toLowerCase())continue;seen.add(key);
  libraries.push({root,...inspectLibrary(root)});
 }
 const populated=libraries.filter(library=>library.nonempty),choices=populated.length?populated:libraries;
 if(!choices.length)return{migrated:false};
 if(new Set(choices.map(library=>library.fingerprint)).size>1)throw new Error('发现多份不同的旧资料库，已保留原目录，请选择需要迁移的完整备份');
 const source=choices[0],parent=path.dirname(target),id=crypto.randomUUID();fs.mkdirSync(parent,{recursive:true});
 const stage=path.join(parent,'.cabinnest-migration-'+id),previous=path.join(parent,'.cabinnest-empty-'+id);
 let parked=false,committed=false;fs.mkdirSync(stage);
 try{
  const db=new DatabaseSync(path.join(source.root,'projectdesk.sqlite'),{readOnly:true});try{db.prepare('VACUUM INTO ?').run(path.join(stage,'projectdesk.sqlite'));}finally{db.close();}
  for(const name of ['files','editing','backups','profile']){
   const from=path.join(source.root,name);if(!fs.existsSync(from)){if(name==='files'||name==='editing')fs.mkdirSync(path.join(stage,name));continue;}
   noLinks(from);fs.cpSync(from,path.join(stage,name),{recursive:true,preserveTimestamps:true,filter:file=>!['Cache','Code Cache','GPUCache','GPUPersistentCache','GrShaderCache','ShaderCache','DawnGraphiteCache','DawnWebGPUCache','crash-dumps','CrashDumps','DevToolsActivePort','SingletonLock','SingletonCookie','SingletonSocket'].includes(path.basename(file))});
  }
  assert.equal(inspectLibrary(stage).fingerprint,source.fingerprint,'迁移副本内容不一致');
  assert.equal(inspectLibrary(source.root).fingerprint,source.fingerprint,'迁移期间旧资料发生变化');
  const config=path.join(stage,'profile','auto-backup.json');if(fs.existsSync(config)){const value=JSON.parse(fs.readFileSync(config,'utf8'));value.lastFingerprint=null;fs.writeFileSync(config,JSON.stringify(value,null,2));}
  fs.writeFileSync(path.join(stage,'storage-migration.json'),JSON.stringify({schema:1,source:source.root,migratedAt:new Date().toISOString(),projects:source.tables.projects.length,documents:source.tables.documents.length},null,2));
  if(fs.existsSync(target)){if(fs.existsSync(database))throw new Error('目标资料库已存在，停止迁移');noLinks(target);if(fs.readdirSync(target).some(name=>name!=='profile'))throw new Error('目标目录已有文件，停止自动迁移并保留原目录');fs.renameSync(target,previous);parked=true;}
  fs.renameSync(stage,target);committed=true;
  if(parked){try{fs.rmSync(previous,{recursive:true});}catch{}}
  return{migrated:true,source:source.root,projects:source.tables.projects.length,documents:source.tables.documents.length};
 }catch(error){if(!committed&&parked&&!fs.existsSync(target))fs.renameSync(previous,target);throw error;}
 finally{if(!committed&&fs.existsSync(stage)){try{noLinks(stage);fs.rmSync(stage,{recursive:true});}catch{}}}
}
module.exports={migrateInstalledData,inspectLibrary};
