const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function inspectSource(source){const s=fs.lstatSync(source);if(!s.isFile()||s.isSymbolicLink())throw new Error('请选择普通文件');if(s.size>250*1024*1024)throw new Error('单个文件暂支持最大 250 MB');return{hash:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),name:path.basename(source),size:s.size};}
class ImportPlans{
 constructor(store,clock=()=>Date.now()){this.store=store;this.clock=clock;this.plans=new Map();}
 prepare(selection,input){
  if(input.documentId)return null;const store=this.store,project=store.assertProject(input.projectId),requirement=store.assertRequirement(input.requirementId,project);
  for(const [id,p] of this.plans)if(this.clock()-p.created>600000)this.plans.delete(id);
  const candidates=store.db.prepare(`SELECT d.id,d.title,d.current_version_id,v.file_name,v.label,(SELECT count(*) FROM versions WHERE document_id=d.id) version_count FROM documents d JOIN versions v ON v.id=d.current_version_id LEFT JOIN document_requirements dr ON dr.document_id=d.id WHERE d.kind='file' AND d.deleted_at IS NULL AND d.project_id IS ? AND dr.requirement_id IS ?`).all(project,requirement);
  const files=selection.files.map(source=>{const key=crypto.randomUUID();let info;try{info=inspectSource(source);}catch{return{source,key};}const duplicate=store.db.prepare('SELECT d.id FROM versions v JOIN documents d ON d.id=v.document_id WHERE v.sha256=? AND d.project_id IS ? AND d.deleted_at IS NULL LIMIT 1').get(info.hash,project);const matches=duplicate?[]:candidates.filter(c=>c.file_name.normalize('NFC').toLowerCase()===info.name.normalize('NFC').toLowerCase());return{source,key,...info,candidates:matches};});
  const conflicts=files.filter(f=>f.candidates?.length).map(f=>({key:f.key,name:f.name,size:f.size,candidates:f.candidates.map(c=>({id:c.id,title:c.title,fileName:c.file_name,versionLabel:c.label,versionCount:c.version_count}))}));if(!conflicts.length)return null;
  const token=crypto.randomUUID();if(this.plans.size>=5)this.plans.delete(this.plans.keys().next().value);this.plans.set(token,{created:this.clock(),generation:store.generation,files,selection,input:{...input}});return{needsDecision:true,token,conflicts,total:files.length};
 }
 resolve(token,choices){
  const p=this.plans.get(token);if(!p||this.clock()-p.created>600000||p.generation!==this.store.generation){this.plans.delete(token);throw new Error('本次导入已过期，请重新拖入或选择文件');}
  if(!Array.isArray(choices))throw new Error('请选择每个同名文件的处理方式');const decisions=new Map(choices.map(c=>[c.key,c]));const conflicts=p.files.filter(f=>f.candidates?.length);if(choices.length!==conflicts.length||decisions.size!==conflicts.length)throw new Error('请选择每个同名文件的处理方式');
  this.store.assertRequirement(p.input.requirementId,this.store.assertProject(p.input.projectId));
  for(const f of p.files){if(f.hash&&inspectSource(f.source).hash!==f.hash)throw new Error('源文件已变化，请重新拖入后确认');if(!f.candidates?.length)continue;const d=decisions.get(f.key);if(!d||!['version','new','skip'].includes(d.action))throw new Error('同名文件的处理方式无效');if(d.action==='version'){const candidate=f.candidates.find(c=>c.id===d.documentId);if(!candidate)throw new Error('请选择有效的更新目标');const current=this.store.getDocument(candidate.id);if(current.kind!=='file'||current.current_version_id!==candidate.current_version_id||current.project_id!==(p.input.projectId||null)||(current.requirement?.id||null)!==(p.input.requirementId||null))throw new Error('目标资料已变化，请重新导入后确认');}}
  this.plans.delete(token);return{selection:p.selection,input:p.input,steps:p.files.map(f=>{const d=decisions.get(f.key);return{source:f.source,skip:d?.action==='skip',documentId:d?.action==='version'?d.documentId:undefined};})};
 }
 cancel(token){return this.plans.delete(token);}
}
module.exports={ImportPlans,inspectSource};
