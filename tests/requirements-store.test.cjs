const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../main/store.cjs'),{DatabaseSync}=require('node:sqlite');
const base=path.resolve(__dirname,'../qa-store');fs.mkdirSync(base,{recursive:true});
function fixture(){const root=fs.mkdtempSync(path.join(base,'requirements-')),store=new Store(root),p=store.saveProject({name:'采购平台'}),q=store.saveProject({name:'财务项目'}),r=store.saveRequirement({projectId:p.id,title:'采购审批优化',code:'REQ-001'});return{root,store,p,q,r};}
test('需求支持多份不同类型资料，修改需求不会改变正文或历史版本',()=>{
 const{store,p,r}=fixture(),a=store.createNote({title:'审批规则',type:'FS 功能说明书',projectId:p.id,requirementId:r.id}),b=store.createNote({title:'接口技术说明',type:'技术说明',projectId:p.id,requirementId:r.id});
 assert.equal(store.requirements(p.id)[0].document_count,2);assert.equal(store.getDocument(a.id).requirement.code,'REQ-001');assert.equal(store.getDocument(b.id).requirement.id,r.id);
 const before=store.getDocument(a.id);store.saveRequirement({id:r.id,title:'采购审批与授权优化',status:'进行中'});const after=store.getDocument(a.id);assert.equal(after.body_html,before.body_html);assert.deepEqual(after.versions,before.versions);assert.equal(after.requirement.title,'采购审批与授权优化');
 assert.equal(store.listDocuments({query:'REQ-001'}).length,2);assert.equal(store.listDocuments({query:'采购审批与授权'}).length,2);store.close();
});
test('批量归属只接受同项目资料，失败时不会留下部分修改',()=>{
 const{store,p,q,r}=fixture(),a=store.createNote({title:'已有 Word 对应笔记',projectId:p.id}),b=store.createNote({title:'其他项目资料',projectId:q.id});
 assert.throws(()=>store.assignRequirement([a.id,b.id],r.id),/同一个项目/);assert.equal(store.getDocument(a.id).requirement,null);
 assert.throws(()=>store.createNote({title:'非法跨项目',projectId:q.id,requirementId:r.id}),/同一个项目/);
 const n=store.listDocuments().length;assert.throws(()=>store.assignRequirement([a.id,'missing'],r.id),/资料不存在/);assert.equal(store.listDocuments().length,n);
 store.assignRequirement([a.id,a.id],r.id);assert.equal(store.requirements(p.id)[0].document_count,1);store.assignRequirement([a.id],'');assert.equal(store.getDocument(a.id).requirement,null);assert.throws(()=>store.saveRequirement({id:r.id,projectId:q.id}),/原项目/);store.close();
});
test('导入多种附件到需求，重复导入不会覆盖其他需求归属，新版本保留原归属',()=>{
 const{root,store,p,r}=fixture(),second=store.saveRequirement({projectId:p.id,title:'报表优化'}),file=path.join(root,'字段说明.xlsx');fs.writeFileSync(file,'附件的不可变字节');
 const imported=store.importFile(file,{projectId:p.id});assert.equal(store.getDocument(imported.id).requirement,null);
 const linked=store.importFile(file,{projectId:p.id,requirementId:r.id});assert.equal(linked.duplicate,true);assert.equal(linked.linked,true);assert.equal(store.getDocument(imported.id).requirement.id,r.id);
 assert.equal(store.importFile(file,{projectId:p.id,requirementId:r.id}).linked,false);assert.throws(()=>store.importFile(file,{projectId:p.id,requirementId:second.id}),/其他需求/);
 fs.writeFileSync(file,'第二版附件');store.importFile(file,{documentId:imported.id});assert.equal(store.getDocument(imported.id).versions.length,2);assert.equal(store.getDocument(imported.id).requirement.id,r.id);store.close();
});
test('回收恢复保留需求归属；跨项目移动解除归属并带走关联待办',()=>{
 const{store,p,q,r}=fixture(),d=store.createNote({title:'需求文件',projectId:p.id,requirementId:r.id}),t=store.saveTask({title:'确认字段',documentId:d.id});
 store.trash('document',d.id);assert.equal(store.requirements(p.id)[0].document_count,0);store.trash('document',d.id,true);assert.equal(store.getDocument(d.id).requirement.id,r.id);
 store.updateDocument({id:d.id,projectId:q.id});assert.equal(store.getDocument(d.id).requirement,null);assert.equal(store.listTasks().find(x=>x.id===t.id).project_id,q.id);assert.equal(store.requirements(p.id)[0].document_count,0);store.close();
});
test('完整备份与重启保留需求、归属、文件和版本',()=>{
 const{root,store,p,r}=fixture(),d=store.createNote({title:'需求说明',projectId:p.id,requirementId:r.id}),backup=store.backup(path.join(root,'backups'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'))).schema,2);store.assignRequirement([d.id],'');store.saveRequirement({id:r.id,title:'临时修改'});store.restoreBackup(backup);store.close();const reopened=new Store(root);assert.equal(reopened.requirements(p.id)[0].title,'采购审批优化');assert.equal(reopened.getDocument(d.id).requirement.id,r.id);assert.equal(reopened.getDocument(d.id).versions.length,1);reopened.close();
});
test('旧版数据库迁移和旧备份恢复不改动原业务记录，迁移可重复执行',()=>{
 const{root,store,p}=fixture();store.createNote({title:'旧资料',projectId:p.id});store.saveTask({title:'旧待办'});store.db.exec('DELETE FROM document_requirements;DROP TABLE document_requirements;DROP TABLE requirements;PRAGMA user_version=1;');store.close();
 const readRows=()=>{const db=new DatabaseSync(path.join(root,'projectdesk.sqlite'),{readOnly:true});const rows={};for(const n of ['projects','documents','versions','tasks'])rows[n]=db.prepare(`SELECT * FROM ${n} ORDER BY id`).all();db.close();return rows;};const before=readRows();
 const backup=path.join(root,'legacy-backup');fs.mkdirSync(backup);const db=new DatabaseSync(path.join(root,'projectdesk.sqlite'));db.prepare('VACUUM INTO ?').run(path.join(backup,'projectdesk.sqlite'));db.close();for(const name of ['files','editing'])fs.cpSync(path.join(root,name),path.join(backup,name),{recursive:true});fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({app:'projectdesk',schema:1,databaseSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(backup,'projectdesk.sqlite'))).digest('hex')}));
 let migrated=new Store(root);assert.equal(migrated.requirements().length,0);migrated.close();assert.deepEqual(readRows(),before);migrated=new Store(root);assert.deepEqual(readRows(),before);migrated.saveRequirement({projectId:p.id,title:'升级后的需求'});migrated.restoreBackup(backup);assert.equal(migrated.requirements().length,0);assert.deepEqual(readRows(),before);migrated.close();
});
