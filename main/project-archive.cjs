const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
const {exportDocx}=require('./export-docx.cjs'),{projectWorkbook}=require('./project-workbook.cjs');
const {cleanBody,plain}=require('./store.cjs'),{TYPES,STATUSES,PROJECT_STATUSES}=require('../shared/constants.cjs');
const uid=()=>crypto.randomUUID(),hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const normalized=p=>path.resolve(p).toLowerCase(),inside=(root,p)=>normalized(p)===normalized(root)||normalized(p).startsWith(normalized(root)+path.sep);
function safeName(value,max=80){let s=String(value||'未命名').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,max).replace(/[. ]+$/g,'');if(!s)s='未命名';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))s='_'+s;return s;}
function uniqueName(name,used){const ext=path.extname(name),stem=name.slice(0,name.length-ext.length);let next=name,n=2;while(used.has(next.toLowerCase()))next=`${stem} (${n++})${ext}`;used.add(next.toLowerCase());return next;}
function archivePath(root,relative,mustExist=true){
 if(typeof relative!=='string'||!relative||relative.length>1000||relative.includes('\\')||relative.includes(':')||relative.split('/').some(s=>!s||s==='.'||s==='..'||/[\x00-\x1f]/.test(s)||/[. ]$/.test(s)))throw new Error('归档中的文件路径无效');
 const target=path.resolve(root,...relative.split('/'));if(!inside(root,target))throw new Error('归档文件路径超出目录');
 if(mustExist){let current=root;for(const part of relative.split('/')){current=path.join(current,part);const stat=fs.lstatSync(current);if(stat.isSymbolicLink())throw new Error('归档不支持链接文件或链接目录');}if(!fs.statSync(target).isFile())throw new Error('归档文件缺失或不是普通文件');}
 return target;
}
async function copyHash(source,destination){
 const hasher=crypto.createHash('sha256');let size=0;
 const input=fs.createReadStream(source),tap=new Transform({transform(chunk,encoding,callback){size+=chunk.length;hasher.update(chunk);callback(null,chunk);}});
 if(destination){fs.mkdirSync(path.dirname(destination),{recursive:true});await pipeline(input,tap,fs.createWriteStream(destination,{flags:'wx'}));}
 else await pipeline(input,tap,new Transform({transform(chunk,encoding,callback){callback();}}));
 return{sha256:hasher.digest('hex'),size};
}
function snapshotProject(store,id){
 return store.transaction(()=>{
  const project={...store.project(id)},requirements=store.db.prepare('SELECT * FROM requirements WHERE project_id=? ORDER BY created_at,id').all(id);
  const documents=store.db.prepare('SELECT d.*,dr.requirement_id,dr.created_at requirement_assigned_at FROM documents d LEFT JOIN document_requirements dr ON dr.document_id=d.id WHERE d.project_id=? ORDER BY d.created_at,d.id').all(id).map(({search_text,index_state,...d})=>({...d,tags:JSON.parse(d.tags)}));
  const versions=store.db.prepare('SELECT v.* FROM versions v JOIN documents d ON d.id=v.document_id WHERE d.project_id=? ORDER BY v.created_at,v.id').all(id);
  const tasks=store.db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY created_at,id').all(id);
  return{project,requirements,documents,versions,tasks};
 });
}
function archiveSummary(a){return{projectName:a.project.name,projectCode:a.project.code,createdAt:a.createdAt,requirements:a.requirements.length,documents:a.documents.filter(d=>!d.deleted_at).length,tasks:a.tasks.filter(t=>!t.deleted_at).length,versions:a.versions.length,workingCopies:a.workingCopies.length};}
async function exportProject(store,id,destination,onProgress=()=>{}){
 const parent=fs.realpathSync(destination);if(!fs.statSync(parent).isDirectory()||inside(store.root,parent))throw new Error('请选择应用 data 目录以外的位置保存项目归档');
 const data=snapshotProject(store,id),createdAt=new Date().toISOString(),archive={app:'projectdesk-project',format:1,createdAt,...data,files:[],workingCopies:[]};
 const stage=path.join(parent,'.projectdesk-export-'+uid());fs.mkdirSync(stage);
 try{
  const folders=new Map(),usedFolders=new Set(['归档数据','未归属需求']),usedFiles=new Map(),currentVersions=new Map(data.versions.map(v=>[v.id,v]));
  for(const [i,r] of data.requirements.entries()){const folder=uniqueName(safeName(`${r.code||'需求'+String(i+1).padStart(3,'0')}_${r.title}`,65),usedFolders);folders.set(r.id,folder);fs.mkdirSync(path.join(stage,folder));}
  const writeBuffer=(relative,bytes)=>{const target=archivePath(stage,relative,false);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});archive.files.push({path:relative,sha256:hash(bytes),size:bytes.length});};
  const writeCopy=async(source,relative,expected)=>{const result=await copyHash(source,archivePath(stage,relative,false));if(expected&&result.sha256!==expected)throw new Error('资料副本校验失败，未生成归档');archive.files.push({path:relative,...result});return result;};
  let complete=0;const total=data.documents.length+data.versions.length;
  for(const d of data.documents){
   onProgress({phase:'正在整理项目资料',complete:complete++,total});const current=currentVersions.get(d.current_version_id);if(!current||current.document_id!==d.id)throw new Error('资料当前版本不完整：'+d.title);
   d.ext=d.kind==='note'?'.docx':current.ext;d.versionLabel=current.label;
   if(!d.deleted_at){const folder=folders.get(d.requirement_id)||'未归属需求';if(!usedFiles.has(folder))usedFiles.set(folder,new Set());const stem=safeName(d.title,90).replace(new RegExp(d.ext.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i'),'');d.readablePath=folder+'/'+uniqueName(stem+d.ext,usedFiles.get(folder));
    if(d.kind==='note')writeBuffer(d.readablePath,await exportDocx(d.body_html,d.title));else await writeCopy(archivePath(store.root,current.store_name),d.readablePath,current.sha256);
   }else d.readablePath=null;
  }
  const docs=new Map(data.documents.map(d=>[d.id,d]));
  archive.versions=[];
  for(const v of data.versions){
   onProgress({phase:'正在保留历史版本',complete:complete++,total});const d=docs.get(v.document_id),{store_name,source_path,index_text,...record}=v;
   if(store_name){record.archivePath=v.id===d.current_version_id&&d.readablePath?d.readablePath:`归档数据/历史版本/${d.id}/${v.id}${v.ext}`;if(record.archivePath!==d.readablePath)await writeCopy(archivePath(store.root,store_name),record.archivePath,v.sha256);}
   else record.archivePath=null;archive.versions.push(record);
  }
  for(const d of data.documents){const dir=path.join(store.root,'editing',d.id),meta=path.join(dir,'session.json');if(!fs.existsSync(meta))continue;const session=JSON.parse(fs.readFileSync(meta,'utf8'));if(typeof session.name!=='string'||path.basename(session.name)!==session.name||!currentVersions.has(session.versionId)||currentVersions.get(session.versionId).document_id!==d.id)throw new Error('外部编辑副本记录无效：'+d.title);if(!fs.existsSync(path.join(dir,session.name)))continue;const source=archivePath(store.root,'editing/'+d.id+'/'+session.name);
   const relative=`归档数据/未收回编辑副本/${d.id}/${safeName(session.name,110)}`,result=await writeCopy(source,relative);archive.workingCopies.push({documentId:d.id,versionId:session.versionId,name:session.name,baselineHash:session.baselineHash,path:relative,...result});
  }
  onProgress({phase:'正在生成项目与待办清单',complete:total,total});writeBuffer('项目与待办清单.xlsx',await projectWorkbook(archive));
  writeBuffer('归档说明.txt',Buffer.from(`项目：${data.project.name}\n\n需求文件夹保存已归档资料的当前版本，Word、Excel 等导入文件保留原格式，应用内笔记导出为 Word。\n项目与待办清单.xlsx 包含项目概况、需求、资料和待办清单。\n项目归档.json 与归档数据目录用于重新导入应用，包含历史版本和回收站记录。\n如有未收回的外部编辑，副本也会保留；当前资料以应用中已保存的版本为准。\n\n可把整个文件夹上传到 Google 云端硬盘，或导出到桌面版云端硬盘的同步目录。\n重新导入时，在CabinNest的“导入项目归档”中选择本文件夹，将创建独立项目副本，不覆盖现有项目。\n归档是导出时点的快照；要重新导入，请保持归档文件内容和目录结构完整。\n`,'utf8'));
  fs.writeFileSync(path.join(stage,'项目归档.json'),JSON.stringify(archive,null,2));
  const timestamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/[: ]/g,'-');
  const used=new Set(fs.readdirSync(parent).map(s=>s.toLowerCase())),name=uniqueName(safeName(data.project.name,50)+'_归档_'+timestamp,used),target=path.join(parent,name);fs.renameSync(stage,target);return{path:target,...archiveSummary(archive)};
 }catch(e){if(inside(parent,stage)&&path.basename(stage).startsWith('.projectdesk-export-'))fs.rmSync(stage,{recursive:true,force:true});throw e;}
}
function readArchive(folder){
 const root=fs.realpathSync(folder);if(!fs.existsSync(path.join(root,'项目归档.json')))throw new Error('请选择包含“项目归档.json”的归档文件夹');const filename=archivePath(root,'项目归档.json');if(fs.statSync(filename).size>256*1024*1024)throw new Error('归档清单过大');
 let a;try{a=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{throw new Error('无法读取项目归档清单');}
 if(a?.app!=='projectdesk-project'||a.format!==1)throw new Error('不是受支持的项目归档，请选择包含“项目归档.json”的归档文件夹');
 const string=(v,name,max=5000,optional=false)=>{if(optional&&(v===null||v===undefined))return;if(typeof v!=='string'||v.length>max)throw new Error('归档中的'+name+'无效');};
 const stamp=(v,optional=false)=>{if(optional&&v===null)return;string(v,'时间',40);if(!Number.isFinite(Date.parse(v)))throw new Error('归档时间无效');};
 const id=v=>{string(v,'编号',100);if(!v)throw new Error('归档编号为空');};
 for(const key of ['requirements','documents','versions','tasks','files','workingCopies'])if(!Array.isArray(a[key])||a[key].length>100000)throw new Error('归档条目无效或过多');
 if(!a.project||typeof a.project!=='object')throw new Error('归档项目信息无效');id(a.project.id);string(a.project.name,'项目名称',150);if(!a.project.name.trim())throw new Error('项目名称为空');string(a.project.code,'项目编号',60);string(a.project.client,'业务方',100);string(a.project.description,'项目说明',2000);if(!PROJECT_STATUSES.includes(a.project.status))throw new Error('项目状态无效');stamp(a.project.created_at);stamp(a.project.updated_at);stamp(a.createdAt);
 const makeMap=(rows,kind)=>{const m=new Map();for(const row of rows){if(!row||typeof row!=='object')throw new Error(kind+'记录无效');id(row.id);if(m.has(row.id))throw new Error(kind+'编号重复');m.set(row.id,row);}return m;};
 const reqs=makeMap(a.requirements,'需求'),docs=makeMap(a.documents,'资料'),versions=makeMap(a.versions,'版本');makeMap(a.tasks,'待办');
 for(const r of a.requirements){if(r.project_id!==a.project.id||!['待分析','进行中','已完成','暂停'].includes(r.status))throw new Error('需求归属或状态无效');string(r.title,'需求名称',150);string(r.code,'需求编号',60);string(r.description,'需求说明',5000);stamp(r.created_at);stamp(r.updated_at);}
 const files=new Map(),usedVersionPaths=new Set();for(const f of a.files){if(!f||typeof f!=='object'||files.has(f.path)||!/^([a-f0-9]{64})$/.test(f.sha256)||!Number.isSafeInteger(f.size)||f.size<0)throw new Error('归档文件清单无效');const target=archivePath(root,f.path);if(fs.statSync(target).size!==f.size)throw new Error('归档文件大小不匹配：'+f.path);files.set(f.path,f);}
 for(const d of a.documents){if(d.project_id!==a.project.id||!TYPES.includes(d.type)||!STATUSES.includes(d.status)||!['note','file'].includes(d.kind))throw new Error('资料类型或归属无效');string(d.title,'资料标题',150);if(!d.title.trim())throw new Error('资料标题为空');string(d.summary,'资料摘要',2000);string(d.owner,'编写人',80);if(!Array.isArray(d.tags)||d.tags.length>20||d.tags.some(t=>typeof t!=='string'||t.length>50))throw new Error('资料标签无效');if(d.requirement_id&&!reqs.has(d.requirement_id))throw new Error('资料对应的需求缺失');if(!versions.has(d.current_version_id)||versions.get(d.current_version_id).document_id!==d.id)throw new Error('资料当前版本缺失');if(d.readablePath&&!files.has(d.readablePath))throw new Error('资料当前文件缺失');if(typeof d.body_html!=='string')throw new Error('文档正文无效');stamp(d.created_at);stamp(d.updated_at);stamp(d.deleted_at,true);}
 for(const v of a.versions){const d=docs.get(v.document_id);if(!d)throw new Error('历史版本对应的资料缺失');string(v.label,'版本说明',80);stamp(v.created_at);if(d.kind==='file'){if(!/^\.[a-z0-9]{1,12}$/i.test(v.ext)||!files.has(v.archivePath)||usedVersionPaths.has(v.archivePath)||files.get(v.archivePath).sha256!==v.sha256||files.get(v.archivePath).size!==v.size)throw new Error('文件版本记录无效');usedVersionPaths.add(v.archivePath);string(v.file_name,'文件名',260);}else if(typeof v.body_html!=='string'||v.archivePath)throw new Error('文档版本内容无效');}
 for(const t of a.tasks){if(t.project_id!==a.project.id||t.document_id&&!docs.has(t.document_id)||!['todo','doing','done'].includes(t.status)||!['high','normal','low'].includes(t.priority))throw new Error('待办归属或状态无效');string(t.title,'待办内容',240);if(!t.title.trim())throw new Error('待办内容为空');string(t.notes,'待办备注',5000);if(t.due_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(t.due_date)||!Number.isFinite(Date.parse(t.due_date))||new Date(t.due_date).toISOString().slice(0,10)!==t.due_date))throw new Error('截止日期无效');stamp(t.created_at);stamp(t.updated_at);stamp(t.deleted_at,true);}
 const workingDocs=new Set();for(const w of a.workingCopies){if(!docs.has(w.documentId)||workingDocs.has(w.documentId)||versions.get(w.versionId)?.document_id!==w.documentId||!files.has(w.path)||usedVersionPaths.has(w.path)||files.get(w.path).sha256!==w.sha256||!/^([a-f0-9]{64})$/.test(w.baselineHash)||typeof w.name!=='string'||w.name!==path.basename(w.name)||/[<>:"/\\|?*\x00-\x1f]/.test(w.name)||w.name==='.'||w.name==='..')throw new Error('外部编辑副本记录无效');workingDocs.add(w.documentId);usedVersionPaths.add(w.path);}
 return{root,archive:a,summary:archiveSummary(a)};
}
async function importProject(store,folder,onProgress=()=>{}){
 const {root,archive:a}=readArchive(folder),stage=path.join(store.root,'.project-import-'+uid()),createdFiles=[],createdEditing=[];
 fs.mkdirSync(stage);try{
  let complete=0;const staged=new Map();
  for(const file of a.files){onProgress({phase:'正在校验归档文件',complete:complete++,total:a.files.length});const target=path.join(stage,uid()),result=await copyHash(archivePath(root,file.path),target);if(result.sha256!==file.sha256||result.size!==file.size)throw new Error('归档文件校验失败：'+file.path);staged.set(file.path,target);}
  const projectId=uid(),reqs=new Map(a.requirements.map(r=>[r.id,uid()])),docs=new Map(a.documents.map(d=>[d.id,uid()])),versions=new Map(a.versions.map(v=>[v.id,uid()]));
  const names=new Set(store.projects().map(p=>p.name.toLowerCase()));let projectName=a.project.name;if(names.has(projectName.toLowerCase())){const stem=projectName.slice(0,135)+'（归档导入）';projectName=stem;let n=2;while(names.has(projectName.toLowerCase()))projectName=stem+' '+n++;}
  onProgress({phase:'正在创建独立项目副本',complete:a.files.length,total:a.files.length});
  store.transaction(()=>{
   const p=a.project;store.db.prepare('INSERT INTO projects(id,name,code,client,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(projectId,projectName,p.code,p.client,p.description,p.status,p.created_at,p.updated_at);
   for(const r of a.requirements)store.db.prepare('INSERT INTO requirements(id,project_id,title,code,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(reqs.get(r.id),projectId,r.title,r.code,r.description,r.status,r.created_at,r.updated_at);
   for(const d of a.documents){const body=d.kind==='note'?cleanBody(d.body_html):'';store.db.prepare('INSERT INTO documents(id,project_id,title,type,status,tags,summary,owner,kind,body_html,search_text,current_version_id,pinned,index_state,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(docs.get(d.id),projectId,d.title,d.type,d.status,JSON.stringify(d.tags),d.summary,d.owner,d.kind,body,plain(body),versions.get(d.current_version_id),d.pinned?1:0,d.kind==='note'?'ready':'pending',d.deleted_at,d.created_at,d.updated_at);if(d.requirement_id){store.writeRequirement(docs.get(d.id),reqs.get(d.requirement_id));if(d.requirement_assigned_at&&Number.isFinite(Date.parse(d.requirement_assigned_at)))store.db.prepare('UPDATE document_requirements SET created_at=? WHERE document_id=?').run(d.requirement_assigned_at,docs.get(d.id));}}
   for(const v of a.versions){let storeName=null;if(v.archivePath){storeName='files/'+versions.get(v.id)+v.ext;const target=path.join(store.root,storeName);if(fs.existsSync(target))throw new Error('归档目标文件名冲突');fs.renameSync(staged.get(v.archivePath),target);createdFiles.push(target);}const body=v.archivePath?null:cleanBody(v.body_html);store.db.prepare('INSERT INTO versions(id,document_id,label,body_html,file_name,store_name,ext,size,sha256,source_path,index_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(versions.get(v.id),docs.get(v.document_id),v.label,body,v.file_name||null,storeName,v.ext||null,v.size??null,v.sha256||null,'',body?plain(body):'',v.created_at);}
   for(const t of a.tasks)store.db.prepare('INSERT INTO tasks(id,project_id,document_id,title,status,priority,due_date,notes,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(uid(),projectId,t.document_id?docs.get(t.document_id):null,t.title,t.status,t.priority,t.due_date,t.notes,t.deleted_at,t.created_at,t.updated_at);
   for(const w of a.workingCopies){const dir=path.join(store.root,'editing',docs.get(w.documentId));fs.mkdirSync(dir);createdEditing.push(dir);fs.renameSync(staged.get(w.path),path.join(dir,w.name));fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify({name:w.name,versionId:versions.get(w.versionId),baselineHash:w.baselineHash}));}
  });
  return{...archiveSummary(a),projectId,projectName};
 }catch(e){for(const file of createdFiles)fs.unlinkSync(file);for(const dir of createdEditing)if(inside(store.root,dir))fs.rmSync(dir,{recursive:true,force:true});throw e;}
 finally{if(inside(store.root,stage)&&path.basename(stage).startsWith('.project-import-'))fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={exportProject,importProject,readArchive,safeName};
