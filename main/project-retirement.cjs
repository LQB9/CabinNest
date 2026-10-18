const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {exportProject,readArchive}=require('./project-archive.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const KEY='permanent-project-archives';
function inside(root,target){return path.resolve(target).toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep);}
function noLinks(root){if(fs.lstatSync(root).isSymbolicLink())throw new Error('项目文件目录含有链接');for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isSymbolicLink())throw new Error('项目文件目录含有链接');if(e.isDirectory())noLinks(p);}}
function projectFingerprint(store,id){
 const data={project:store.project(id),requirements:store.db.prepare('SELECT * FROM requirements WHERE project_id=? ORDER BY id').all(id),documents:store.db.prepare('SELECT * FROM documents WHERE project_id=? ORDER BY id').all(id).map(({search_text,index_state,...d})=>d),versions:store.db.prepare('SELECT v.* FROM versions v JOIN documents d ON d.id=v.document_id WHERE d.project_id=? ORDER BY v.id').all(id).map(({index_text,...v})=>v),tasks:store.db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY id').all(id),relations:store.db.prepare('SELECT dr.* FROM document_requirements dr JOIN documents d ON d.id=dr.document_id WHERE d.project_id=? ORDER BY dr.document_id').all(id),editing:[]};
 for(const d of data.documents){const dir=path.join(store.root,'editing',d.id);if(!fs.existsSync(dir))continue;noLinks(dir);function walk(current){for(const e of fs.readdirSync(current,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(current,e.name);if(e.isDirectory())walk(p);else if(e.isFile())data.editing.push([path.relative(store.root,p),hash(fs.readFileSync(p))]);}}walk(dir);}
 return hash(JSON.stringify(data));
}
class ProjectRetirement{
 constructor(store){this.store=store;}
 records(){const row=this.store.db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);if(!row)return[];const records=JSON.parse(row.value);if(!Array.isArray(records))throw new Error('历史归档记录无效');return records;}
 save(records){this.store.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY,JSON.stringify(records));}
 list(){return this.records().map(({fingerprint,...r})=>({...r,localPresent:!!this.store.db.prepare('SELECT 1 FROM projects WHERE id=?').get(r.projectId)}));}
 async create(id,directory,onProgress=()=>{}){
  const parent=fs.realpathSync(directory);if(inside(this.store.root,parent)||parent.toLowerCase()===this.store.root.toLowerCase())throw new Error('历史项目应保存在应用资料目录以外');
  const history=path.join(parent,'历史项目');fs.mkdirSync(history,{recursive:true});if(fs.lstatSync(history).isSymbolicLink())throw new Error('历史项目目录不能是链接');
  const fingerprint=projectFingerprint(this.store,id),result=await exportProject(this.store,id,history,onProgress);await this.verify(result.path,onProgress);
  if(projectFingerprint(this.store,id)!==fingerprint)throw new Error('归档期间项目发生变化，文件已保留，请重新归档后再移出本机');
  const record={id:crypto.randomUUID(),projectId:id,projectName:result.projectName,path:result.path,createdAt:result.createdAt,requirements:result.requirements,documents:result.documents,tasks:result.tasks,versions:result.versions,fingerprint,state:'local-kept'};
  this.save([record,...this.records()]);return this.list().find(r=>r.id===record.id);
 }
 async verify(folder,onProgress=()=>{}){const {archive}=readArchive(folder);for(const [i,f]of archive.files.entries()){onProgress({phase:'正在验证永久归档',complete:i,total:archive.files.length});const filename=path.resolve(folder,...f.path.split('/'));if(!inside(folder,filename)||hash(fs.readFileSync(filename))!==f.sha256)throw new Error('归档文件校验失败，保留本机项目：'+f.path);}return archive;}
 record(id){const r=this.records().find(r=>r.id===id);if(!r)throw new Error('未找到历史归档记录');return r;}
 async removeLocal(id,{projectName,archiveConfirmed}={},onProgress=()=>{}){
  const record=this.record(id),store=this.store,project=store.project(record.projectId);
  if(archiveConfirmed!==true||projectName!==project.name)throw new Error('请确认归档可用，并输入完整项目名称');
  if(projectFingerprint(store,project.id)!==record.fingerprint)throw new Error('项目已有新修改，请重新结项归档后再移出本机');
  const archive=await this.verify(record.path,onProgress);if(archive.project.id!==project.id)throw new Error('历史归档与当前项目不匹配');
  if(projectFingerprint(store,project.id)!==record.fingerprint)throw new Error('校验期间项目已变化，请重新归档');
  const docs=store.db.prepare('SELECT id FROM documents WHERE project_id=?').all(project.id),docIds=new Set(docs.map(d=>d.id));
  for(const t of store.db.prepare('SELECT document_id,project_id FROM tasks WHERE document_id IS NOT NULL').all())if(docIds.has(t.document_id)&&t.project_id!==project.id)throw new Error('存在跨项目关联待办，请先调整归属');
  const paths=new Set(store.db.prepare('SELECT v.store_name FROM versions v JOIN documents d ON d.id=v.document_id WHERE d.project_id=? AND v.store_name IS NOT NULL').all(project.id).map(v=>v.store_name));
  for(const name of paths)if(store.db.prepare('SELECT count(*) n FROM versions v JOIN documents d ON d.id=v.document_id WHERE v.store_name=? AND d.project_id IS NOT ?').get(name,project.id).n)throw new Error('存在其他项目引用的附件，保留本机项目');
  onProgress({phase:'正在保存移出前的本机恢复备份'});const previous=store.backup(path.join(store.root,'backups','project-retirements'));
  const stage=path.join(store.root,'.project-retirement-'+crypto.randomUUID()),moved=[];fs.mkdirSync(stage);
  const move=(source,destination)=>{if(!inside(store.root,source)||fs.lstatSync(source).isSymbolicLink())throw new Error('项目文件路径无效');if(fs.statSync(source).isDirectory())noLinks(source);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(source,destination);moved.push([source,destination]);};
  let committed=false,rollbackComplete=false,warning=null;
  try{
   for(const name of paths){const source=path.resolve(store.root,name);if(!inside(path.join(store.root,'files'),source))throw new Error('附件路径无效');move(source,path.join(stage,path.relative(store.root,source)));}
   for(const d of docs){const source=path.join(store.root,'editing',d.id);if(fs.existsSync(source))move(source,path.join(stage,'editing',d.id));}
   store.transaction(()=>{store.db.prepare('DELETE FROM tasks WHERE project_id=?').run(project.id);store.db.prepare('DELETE FROM document_requirements WHERE document_id IN (SELECT id FROM documents WHERE project_id=?)').run(project.id);store.db.prepare('DELETE FROM documents WHERE project_id=?').run(project.id);store.db.prepare('DELETE FROM requirements WHERE project_id=?').run(project.id);store.db.prepare('DELETE FROM projects WHERE id=?').run(project.id);this.save(this.records().map(r=>r.id===id?{...r,state:'local-removed',removedAt:new Date().toISOString()}:r));});committed=true;
  }catch(e){let failed=false;for(const [source,destination]of moved.reverse())if(fs.existsSync(destination)){try{fs.mkdirSync(path.dirname(source),{recursive:true});fs.renameSync(destination,source);}catch{failed=true;}}if(failed)throw new Error('移出未完成，已保留暂存文件和移出前的完整备份，请先恢复本机备份');rollbackComplete=true;throw e;}
  finally{if((committed||rollbackComplete)&&fs.existsSync(stage)&&inside(store.root,stage)&&fs.realpathSync(stage)===stage){noLinks(stage);try{fs.rmSync(stage,{recursive:true,force:true});}catch(e){if(!committed)throw e;warning='项目已移出，部分占用中的本机副本未能清理；历史归档和本机恢复备份均已保留';}}}
  return{...this.list().find(r=>r.id===id),previous,warning};
 }
}
module.exports={ProjectRetirement,projectFingerprint};
