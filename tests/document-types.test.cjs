const test=require('node:test'),assert=require('node:assert/strict');
const {TYPE_ORDER,typeTone,orderDocumentsByType}=require('../shared/document-types.cjs');
const {TYPES}=require('../shared/constants.cjs'),{inferType,Store}=require('../main/store.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('需求内先显示 FS，再显示技术资料；同类型保留原有顺序，原列表不改变',()=>{
 const documents=[{id:1,type:'其他资料'},{id:2,type:'技术说明'},{id:3,type:'FS 功能说明书'},{id:4,type:'技术说明'},{id:5,type:'技术交接'}];
 assert.deepEqual(orderDocumentsByType(documents).map(d=>d.id),[3,2,4,5,1]);assert.deepEqual(documents.map(d=>d.id),[1,2,3,4,5]);
 assert.deepEqual(new Set(TYPE_ORDER),new Set(TYPES));assert.notEqual(typeTone('FS 功能说明书'),typeTone('技术说明'));
});
test('开发技术说明和技术文档按文件名识别，不凭 Word 或 Excel 格式推断用途',()=>{
 for(const file of ['供应商开发技术说明.docx','接口开发说明.xlsx','接口技术文档.pdf'])assert.equal(inferType(file),'技术说明');
 assert.equal(inferType('采购功能说明书.doc'),'FS 功能说明书');assert.equal(inferType('供应商导入模板.xlsx'),'其他资料');assert.equal(inferType('附件.docx'),'其他资料');
});
test('修改资料类型只改分类，保留文件字节、历史版本、需求及待办关联，重启后仍有效',()=>{
 const base=path.resolve(__dirname,'../qa-store');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'document-types-')),file=path.join(root,'字段清单.xlsx');fs.writeFileSync(file,'分类修改不转换文件内容');let store=new Store(path.join(root,'data'));
 try{const p=store.saveProject({name:'示例项目'}),r=store.saveRequirement({projectId:p.id,title:'示例需求'}),imported=store.importFile(file,{projectId:p.id,requirementId:r.id}),before=store.getDocument(imported.id);store.saveTask({title:'核对字段',documentId:before.id});
  const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(store.file(before.id).path)).digest('hex'),hash=sha();store.updateDocument({id:before.id,type:'技术说明'});const after=store.getDocument(before.id);assert.equal(after.type,'技术说明');assert.equal(after.requirement.id,r.id);assert.equal(after.tasks.length,1);assert.deepEqual(after.versions,before.versions);assert.equal(sha(),hash);
  store.close();store=new Store(path.join(root,'data'));assert.equal(store.getDocument(before.id).type,'技术说明');assert.equal(sha(),hash);
 }finally{store.close();}
});
