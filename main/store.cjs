const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { TYPES, STATUSES, PROJECT_STATUSES } = require('../shared/constants.cjs');
const { getTemplate } = require('../shared/templates.cjs');
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const text = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const required = (v, name, max = 150) => { const s = text(v, max); if (!s) throw new Error(`请填写${name}`); return s; };
const cleanBody = v => sanitizeHtml(String(v || ''), {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'h1', 'h2', 'h3', 's', 'u'],
  allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['style'], img: ['src', 'alt', 'width', 'height'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
  allowedStyles: { '*': { 'text-align': [/^(left|center|right)$/], color: [/^#[0-9a-f]{3,8}$/i], 'background-color': [/^#[0-9a-f]{3,8}$/i] } },
  allowedSchemes: ['https', 'http', 'mailto'], allowedSchemesByTag: { img: ['data'] },
});
const plain = html => sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function within(root, target) { const r = path.resolve(root), t = path.resolve(target); if (t !== r && !t.startsWith(r + path.sep)) throw new Error('文件路径超出资料目录'); return t; }
const tags = v => JSON.stringify((Array.isArray(v) ? v : String(v || '').split(/[,，;；]/)).map(t => text(t, 50)).filter(Boolean).slice(0, 20));
const normalize = row => row ? { ...row, tags: row.tags ? JSON.parse(row.tags) : [], pinned: !!row.pinned } : null;

class Store {
  constructor(root) {
    this.root = path.resolve(root); this.generation = uid();
    fs.mkdirSync(this.root, { recursive: true }); fs.mkdirSync(path.join(this.root, 'files'), { recursive: true }); fs.mkdirSync(path.join(this.root, 'editing'), { recursive: true });
    this.open();
  }
  open() {
    this.db = new DatabaseSync(path.join(this.root, 'projectdesk.sqlite'));
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',client TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT '进行中',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),title TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL DEFAULT '草稿',tags TEXT NOT NULL DEFAULT '[]',summary TEXT NOT NULL DEFAULT '',owner TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,body_html TEXT NOT NULL DEFAULT '',search_text TEXT NOT NULL DEFAULT '',current_version_id TEXT,pinned INTEGER NOT NULL DEFAULT 0,index_state TEXT NOT NULL DEFAULT 'ready',deleted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,label TEXT NOT NULL,body_html TEXT,file_name TEXT,store_name TEXT,ext TEXT,size INTEGER,sha256 TEXT,source_path TEXT,index_text TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),document_id TEXT REFERENCES documents(id),title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'todo',priority TEXT NOT NULL DEFAULT 'normal',due_date TEXT,notes TEXT NOT NULL DEFAULT '',deleted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requirements(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT '待分析',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS document_requirements(document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,requirement_id TEXT NOT NULL REFERENCES requirements(id),created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id,deleted_at);
    CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_doc ON tasks(document_id,deleted_at);
    CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
    CREATE INDEX IF NOT EXISTS idx_document_requirements_requirement ON document_requirements(requirement_id);
    PRAGMA user_version=2;`);
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  project(id) { const p = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id); if (!p) throw new Error('项目不存在'); return p; }
  projects() { return this.db.prepare(`SELECT p.*, (SELECT count(*) FROM documents d WHERE d.project_id=p.id AND d.deleted_at IS NULL) document_count, (SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND t.status!='done' AND t.deleted_at IS NULL) task_count FROM projects p ORDER BY p.created_at ASC`).all(); }
  saveProject(input) {
    const id = input.id || uid(), existing = input.id ? this.project(input.id) : null;
    const p = { ...existing, ...input }; const name = required(p.name, '项目名称');
    if (!PROJECT_STATUSES.includes(p.status || '进行中')) throw new Error('项目状态无效');
    this.db.prepare('INSERT INTO projects(id,name,code,client,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code,client=excluded.client,description=excluded.description,status=excluded.status,updated_at=excluded.updated_at').run(id, name, text(p.code, 60), text(p.client, 100), text(p.description), p.status || '进行中', existing?.created_at || now(), now());
    return this.project(id);
  }
  requirements(projectId) {
    return this.db.prepare(`SELECT r.*,p.name project_name,(SELECT count(*) FROM document_requirements dr JOIN documents d ON d.id=dr.document_id WHERE dr.requirement_id=r.id AND d.deleted_at IS NULL) document_count FROM requirements r JOIN projects p ON p.id=r.project_id ${projectId?'WHERE r.project_id=?':''} ORDER BY r.created_at ASC,r.id ASC`).all(...(projectId?[projectId]:[]));
  }
  saveRequirement(input) {
    const old=input.id?this.db.prepare('SELECT * FROM requirements WHERE id=?').get(input.id):null;
    if(input.id&&!old)throw new Error('需求不存在');
    const value={...old,...input},project=this.assertProject(input.projectId===undefined?old?.project_id:input.projectId);
    if(!project)throw new Error('请先选择所属项目');
    if(old&&old.project_id!==project)throw new Error('需求请保留在原项目中；资料可另行移动');
    const status=value.status||'待分析';if(!['待分析','进行中','已完成','暂停'].includes(status))throw new Error('需求状态无效');
    const id=value.id||uid();this.db.prepare('INSERT INTO requirements(id,project_id,title,code,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,code=excluded.code,description=excluded.description,status=excluded.status,updated_at=excluded.updated_at').run(id,project,required(value.title,'需求名称'),text(value.code,60),text(value.description,5000),status,old?.created_at||now(),now());
    return this.requirements(project).find(r=>r.id===id);
  }
  assertRequirement(id,projectId) {
    if(!id)return null;
    const r=this.db.prepare('SELECT * FROM requirements WHERE id=?').get(id);
    if(!r)throw new Error('需求不存在');if(r.project_id!==projectId)throw new Error('资料与需求必须属于同一个项目');return r.id;
  }
  writeRequirement(documentId,requirementId) {
    if(requirementId)this.db.prepare('INSERT INTO document_requirements(document_id,requirement_id,created_at) VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET requirement_id=excluded.requirement_id').run(documentId,requirementId,now());
    else this.db.prepare('DELETE FROM document_requirements WHERE document_id=?').run(documentId);
  }
  assignRequirement(ids,requirementId) {
    if(!Array.isArray(ids)||!ids.length||ids.length>2000)throw new Error('请选择需要归类的资料');
    const docs=[...new Set(ids)].map(id=>this.getDocument(id));
    for(const d of docs)this.assertRequirement(requirementId,d.project_id);
    this.transaction(()=>{for(const d of docs){this.writeRequirement(d.id,requirementId||null);this.db.prepare('UPDATE documents SET updated_at=? WHERE id=?').run(now(),d.id);}});
    return docs.length;
  }
  listDocuments(filters = {}) {
    const where = ['d.deleted_at IS NULL'], args = [];
    if (filters.projectId === 'inbox') where.push('d.project_id IS NULL');
    else if (filters.projectId) { where.push('d.project_id=?'); args.push(filters.projectId); }
    if (filters.type) { where.push('d.type=?'); args.push(filters.type); }
    if (filters.status) { where.push('d.status=?'); args.push(filters.status); }
    if (filters.pinned) where.push('d.pinned=1');
    if(filters.requirementId){where.push('dr.requirement_id=?');args.push(filters.requirementId);}
    if (text(filters.query, 200)) {
      where.push("(d.title LIKE ? ESCAPE '!' OR d.search_text LIKE ? ESCAPE '!' OR d.tags LIKE ? ESCAPE '!' OR d.summary LIKE ? ESCAPE '!' OR p.name LIKE ? ESCAPE '!' OR r.title LIKE ? ESCAPE '!' OR r.code LIKE ? ESCAPE '!')");
      const q = '%' + text(filters.query, 200).replace(/[!%_]/g, c => '!' + c) + '%'; args.push(q,q,q,q,q,q,q);
    }
    return this.db.prepare(`SELECT d.id,d.project_id,d.title,d.type,d.status,d.tags,d.summary,d.owner,d.kind,d.pinned,d.index_state,d.created_at,d.updated_at,p.name project_name,v.label version_label,v.ext,v.size,v.file_name,dr.requirement_id,r.title requirement_title,r.code requirement_code FROM documents d LEFT JOIN projects p ON d.project_id=p.id LEFT JOIN versions v ON d.current_version_id=v.id LEFT JOIN document_requirements dr ON dr.document_id=d.id LEFT JOIN requirements r ON r.id=dr.requirement_id WHERE ${where.join(' AND ')} ORDER BY d.pinned DESC,d.updated_at DESC`).all(...args).map(normalize);
  }
  getDocument(id, includeDeleted = false) {
    const d = this.db.prepare(`SELECT d.*,p.name project_name FROM documents d LEFT JOIN projects p ON d.project_id=p.id WHERE d.id=? ${includeDeleted ? '' : 'AND d.deleted_at IS NULL'}`).get(id);
    if (!d) throw new Error('资料不存在或已移入回收站');
    const versions = this.db.prepare('SELECT id,label,file_name,ext,size,created_at,source_path FROM versions WHERE document_id=? ORDER BY created_at DESC,id DESC').all(id);
    const current = versions.find(v => v.id === d.current_version_id) || null;
    const tasks = this.listTasks({ documentId: id });
    const { search_text, ...rest } = d;
    const requirement=this.db.prepare('SELECT r.* FROM document_requirements dr JOIN requirements r ON r.id=dr.requirement_id WHERE dr.document_id=?').get(id)||null;
    return { ...normalize(rest), versions, current, tasks, requirement };
  }
  assertProject(id) { if (id) this.project(id); return id || null; }
  createNote(input) {
    const id = uid(), stamp = now(), type = TYPES.includes(input.type) ? input.type : '技术笔记';
    const body = cleanBody(input.bodyHtml ?? getTemplate(type)), title = required(input.title, '资料标题');
    const project=this.assertProject(input.projectId),requirement=this.assertRequirement(input.requirementId,project);
    this.transaction(()=>{this.db.prepare('INSERT INTO documents(id,project_id,title,type,status,tags,summary,kind,body_html,search_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, project, title, type, '草稿', tags(input.tags), text(input.summary), 'note', body, plain(body), stamp, stamp);this.writeRequirement(id,requirement);this.snapshot(id,'初稿');});return this.getDocument(id);
  }
  updateDocument(input) {
    const current = this.getDocument(input.id);
    const title = input.title === undefined ? current.title : required(input.title, '资料标题');
    const project = input.projectId === undefined ? current.project_id : this.assertProject(input.projectId);
    const requirement=this.assertRequirement(input.requirementId===undefined?(project===current.project_id?current.requirement?.id:null):input.requirementId,project);
    const type = input.type ?? current.type, status = input.status ?? current.status;
    if (!TYPES.includes(type) || !STATUSES.includes(status)) throw new Error('资料类型或状态无效');
    const body = input.bodyHtml === undefined ? current.body_html : cleanBody(input.bodyHtml);
    if (input.bodyHtml !== undefined && current.kind !== 'note') throw new Error('文件资料请通过上传新版本修改');
    const search = current.kind === 'note' ? plain(body) : this.db.prepare('SELECT search_text FROM documents WHERE id=?').get(input.id).search_text;
    this.transaction(()=>{this.db.prepare('UPDATE documents SET title=?,project_id=?,type=?,status=?,tags=?,summary=?,owner=?,pinned=?,body_html=?,search_text=?,updated_at=? WHERE id=?').run(title, project, type, status, input.tags === undefined ? JSON.stringify(current.tags) : tags(input.tags), input.summary === undefined ? current.summary : text(input.summary), input.owner === undefined ? current.owner : text(input.owner, 80), input.pinned === undefined ? Number(current.pinned) : Number(!!input.pinned), body, search, now(), input.id);
    this.writeRequirement(input.id,requirement);
    if(project!==current.project_id)this.db.prepare('UPDATE tasks SET project_id=? WHERE document_id=?').run(project,input.id);});
    return this.getDocument(input.id);
  }
  importFile(source, input = {}) {
    const stat = fs.lstatSync(source); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('请选择普通文件');
    if (stat.size > 250 * 1024 * 1024) throw new Error('单个文件暂支持最大 250 MB');
    const ext = path.extname(source).toLowerCase();
    const project = this.assertProject(input.projectId);
    const requirement=input.documentId?undefined:this.assertRequirement(input.requirementId,project);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    if (!input.documentId) {
      const duplicate = this.db.prepare('SELECT d.id FROM versions v JOIN documents d ON d.id=v.document_id WHERE v.sha256=? AND d.project_id IS ? AND d.deleted_at IS NULL LIMIT 1').get(hash, project);
      if (duplicate) {
        let linked=false;if(requirement){const d=this.getDocument(duplicate.id);if(d.requirement&&d.requirement.id!==requirement)throw new Error('相同文件已归属其他需求，可在资料信息中调整归属');if(!d.requirement){this.assignRequirement([d.id],requirement);linked=true;}}
        return { duplicate: true, id: duplicate.id, linked };
      }
    }
    const existing = input.documentId ? this.getDocument(input.documentId) : null;
    if (existing && existing.kind !== 'file') throw new Error('富文本资料请保存快照');
    const id = existing?.id || uid(), versionId = uid(), storeName = `files/${versionId}${ext}`;
    const dest = within(this.root, path.join(this.root, storeName));
    let copiedSize;
    try{fs.copyFileSync(source,dest);copiedSize=fs.statSync(dest).size;if(copiedSize>250*1024*1024)throw new Error('单个文件暂支持最大 250 MB');if(crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==hash)throw new Error('源文件在导入时发生变化，请保存后重试');}catch(e){if(fs.existsSync(dest))fs.unlinkSync(dest);throw e;}
    const stamp = now();
    try {
      this.transaction(() => {
        if (!existing) this.db.prepare('INSERT INTO documents(id,project_id,title,type,status,tags,summary,kind,index_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, project, required(input.title || path.basename(source, ext), '资料标题'), TYPES.includes(input.type) ? input.type : inferType(source), '草稿', tags(input.tags), text(input.summary), 'file', 'pending', stamp, stamp);
        if(!existing)this.writeRequirement(id,requirement);
        const count = this.db.prepare('SELECT count(*) n FROM versions WHERE document_id=?').get(id).n;
        this.db.prepare('INSERT INTO versions(id,document_id,label,file_name,store_name,ext,size,sha256,source_path,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(versionId, id, text(input.label || `v${count + 1}`, 80), path.basename(source), storeName, ext, copiedSize, hash, source, stamp);
        this.db.prepare("UPDATE documents SET current_version_id=?,index_state='pending',search_text='',updated_at=? WHERE id=?").run(versionId, stamp, id);
      });
    } catch (e) { fs.unlinkSync(dest); throw e; }
    return { id, versionId, ext, path: dest, duplicate: false };
  }
  setIndex(versionId, value, state = 'ready') {
    const v = this.db.prepare('SELECT * FROM versions WHERE id=?').get(versionId); if (!v) return;
    const s = String(value || '').slice(0, 3000000);
    this.transaction(() => {
      this.db.prepare('UPDATE versions SET index_text=? WHERE id=?').run(s, versionId);
      this.db.prepare('UPDATE documents SET search_text=?,index_state=? WHERE current_version_id=?').run(s, state, versionId);
    });
  }
  pendingIndexes() { return this.db.prepare("SELECT v.id versionId,v.store_name,v.ext FROM versions v JOIN documents d ON d.current_version_id=v.id WHERE d.index_state='pending' AND d.deleted_at IS NULL").all().map(x => ({...x,path:within(this.root,path.join(this.root,x.store_name))})); }
  file(id, versionId) {
    const doc = this.getDocument(id);
    const v = this.db.prepare('SELECT * FROM versions WHERE id=? AND document_id=?').get(versionId || doc.current_version_id, id);
    if (!v?.store_name) throw new Error('该版本没有文件');
    const filename = within(this.root, path.join(this.root, v.store_name));
    if (!fs.existsSync(filename)) throw new Error('资料副本缺失，请从备份恢复');
    return { ...v, path: filename };
  }
  snapshot(id, label) {
    const doc = this.getDocument(id); if (doc.kind !== 'note') throw new Error('文件资料请上传新版本');
    const count = this.db.prepare('SELECT count(*) n FROM versions WHERE document_id=?').get(id).n;
    const versionId = uid();
    this.db.prepare('INSERT INTO versions(id,document_id,label,body_html,index_text,created_at) VALUES(?,?,?,?,?,?)').run(versionId,id,text(label || `快照 ${count + 1}`,80),doc.body_html,plain(doc.body_html),now());
    this.db.prepare('UPDATE documents SET current_version_id=? WHERE id=?').run(versionId,id);
    return this.getDocument(id);
  }
  restoreVersion(id, versionId) {
    const d=this.getDocument(id), v=this.db.prepare('SELECT * FROM versions WHERE id=? AND document_id=?').get(versionId,id);
    if (!v) throw new Error('版本不存在');
    if (d.kind==='note') this.snapshot(id,'恢复前自动快照');
    this.db.prepare("UPDATE documents SET current_version_id=?,body_html=?,search_text=?,index_state=?,updated_at=? WHERE id=?").run(v.id,d.kind==='note'?v.body_html:d.body_html,v.index_text,d.kind==='note'||v.index_text?'ready':'pending',now(),id);
    return this.getDocument(id);
  }
  listTasks(filter={}) {
    const where=['t.deleted_at IS NULL'],args=[];
    if(filter.documentId){where.push('t.document_id=?');args.push(filter.documentId);}
    if(filter.projectId){where.push('t.project_id=?');args.push(filter.projectId);}
    return this.db.prepare(`SELECT t.*,p.name project_name,d.title document_title,d.deleted_at document_deleted FROM tasks t LEFT JOIN projects p ON t.project_id=p.id LEFT JOIN documents d ON t.document_id=d.id WHERE ${where.join(' AND ')} ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END,CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date ASC,t.created_at DESC`).all(...args);
  }
  saveTask(input) {
    const old=input.id?this.db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(input.id):null;
    if(input.id&&!old)throw new Error('待办不存在');
    const t={...old,...input},id=t.id||uid();
    const status=t.status||'todo',priority=t.priority||'normal';
    if(!['todo','doing','done'].includes(status)||!['high','normal','low'].includes(priority))throw new Error('待办状态无效');
    const due=t.dueDate===undefined?t.due_date:t.dueDate;
    if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||Number.isNaN(Date.parse(due))||new Date(due).toISOString().slice(0,10)!==due))throw new Error('截止日期无效');
    const documentId=t.documentId===undefined?t.document_id:t.documentId;
    const doc=documentId?this.getDocument(documentId,true):null;
    const project=doc?doc.project_id:this.assertProject(t.projectId===undefined?t.project_id:t.projectId);
    this.db.prepare('INSERT INTO tasks(id,project_id,document_id,title,status,priority,due_date,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,document_id=excluded.document_id,title=excluded.title,status=excluded.status,priority=excluded.priority,due_date=excluded.due_date,notes=excluded.notes,updated_at=excluded.updated_at').run(id,project,documentId||null,required(t.title,'待办内容',240),status,priority,due||null,text(t.notes,5000),old?.created_at||now(),now());
    return this.listTasks().find(x=>x.id===id);
  }
  trash(kind,id,restore=false) {
    const table=kind==='task'?'tasks':kind==='document'?'documents':null;if(!table)throw new Error('类型无效');
    this.db.prepare(`UPDATE ${table} SET deleted_at=?,updated_at=? WHERE id=?`).run(restore?null:now(),now(),id);
  }
  trashList(){return { documents:this.db.prepare('SELECT d.id,d.title,d.type,d.deleted_at,p.name project_name FROM documents d LEFT JOIN projects p ON p.id=d.project_id WHERE d.deleted_at IS NOT NULL ORDER BY d.deleted_at DESC').all(), tasks:this.db.prepare('SELECT id,title,deleted_at FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() };}
  bootstrap(){return {projects:this.projects(),requirements:this.requirements(),documents:this.listDocuments(),tasks:this.listTasks(),trash:this.trashList(),info:{version:require('../package.json').version,dataDir:this.root,backupDir:path.join(this.root,'backups'),storageBytes:directorySize(path.join(this.root,'files'))}};}
  backup(destination){
    const filesDir=path.join(this.root,'files'),editingDir=path.join(this.root,'editing');
    for(const restricted of [filesDir,editingDir])if(path.resolve(destination)===restricted||path.resolve(destination).startsWith(restricted+path.sep))throw new Error('请选择文件副本目录以外的位置保存备份');
    fs.mkdirSync(destination,{recursive:true});
    const target=path.join(path.resolve(destination),`CabinNest备份-${new Date().toISOString().replace(/[:.]/g,'-')}-${uid().slice(0,6)}`);
    if(target===this.root)throw new Error('备份目录无效');
    fs.mkdirSync(target,{recursive:true});
    this.db.prepare('VACUUM INTO ?').run(path.join(target,'projectdesk.sqlite'));
    fs.cpSync(path.join(this.root,'files'),path.join(target,'files'),{recursive:true});
    fs.cpSync(path.join(this.root,'editing'),path.join(target,'editing'),{recursive:true});
    const manifest={app:'projectdesk',schema:2,createdAt:now(),databaseSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(target,'projectdesk.sqlite'))).digest('hex')};
    fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));return target;
  }
  restoreBackup(source){
    const prepared=require('./backup-format.cjs').prepareBackupRestore(source,this.root);
    try{return this.restorePreparedBackup(prepared.path);}finally{prepared.cleanup();}
  }
  restorePreparedBackup(source){
    const from=path.resolve(source),manifest=JSON.parse(fs.readFileSync(path.join(from,'manifest.json'),'utf8'));
    if(manifest.app!=='projectdesk'||![1,2].includes(manifest.schema))throw new Error('不是有效的CabinNest备份');
    const dbFile=path.join(from,'projectdesk.sqlite');
    if(crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex')!==manifest.databaseSha256)throw new Error('备份数据库校验失败');
    const check=new DatabaseSync(dbFile,{readOnly:true});
    try{
      if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('备份数据库损坏');
      for(const v of check.prepare('SELECT store_name,sha256 FROM versions WHERE store_name IS NOT NULL').all()){
        const f=within(from,path.join(from,v.store_name));if(!fs.existsSync(f))throw new Error('备份缺少附件');
        if(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==v.sha256)throw new Error('备份附件校验失败');
      }
    }finally{check.close();}
    const previous=this.backup(path.join(this.root,'backups'));
    const stage=within(this.root,path.join(this.root,'.restore-'+uid()));fs.mkdirSync(stage);
    fs.copyFileSync(dbFile,path.join(stage,'projectdesk.sqlite'));fs.cpSync(path.join(from,'files'),path.join(stage,'files'),{recursive:true});
    if(fs.existsSync(path.join(from,'editing')))fs.cpSync(path.join(from,'editing'),path.join(stage,'editing'),{recursive:true});else fs.mkdirSync(path.join(stage,'editing'));
    const old=within(this.root,path.join(this.root,'.previous-'+uid()));fs.mkdirSync(old);this.db.close();
    try{
      fs.renameSync(path.join(this.root,'projectdesk.sqlite'),path.join(old,'projectdesk.sqlite'));
      fs.renameSync(path.join(this.root,'files'),path.join(old,'files'));
      fs.renameSync(path.join(this.root,'editing'),path.join(old,'editing'));
      fs.renameSync(path.join(stage,'projectdesk.sqlite'),path.join(this.root,'projectdesk.sqlite'));
      fs.renameSync(path.join(stage,'files'),path.join(this.root,'files'));fs.renameSync(path.join(stage,'editing'),path.join(this.root,'editing'));this.open();
    }catch(e){
      if(fs.existsSync(path.join(old,'projectdesk.sqlite'))){fs.copyFileSync(path.join(old,'projectdesk.sqlite'),path.join(this.root,'projectdesk.sqlite'));}
      if(fs.existsSync(path.join(old,'files'))){fs.cpSync(path.join(old,'files'),path.join(this.root,'files'),{recursive:true});}
      if(fs.existsSync(path.join(old,'editing'))){fs.cpSync(path.join(old,'editing'),path.join(this.root,'editing'),{recursive:true});}
      this.open();throw e;
    }
    this.generation=uid();fs.rmSync(within(this.root,stage),{recursive:true,force:true});fs.rmSync(within(this.root,old),{recursive:true,force:true});return {previous};
  }
  close(){this.db.close();}
}
function directorySize(dir){let size=0;for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isFile())size+=fs.statSync(p).size;}return size;}
function inferType(filename){const s=path.basename(filename).toLowerCase();if(/(^|[^a-z])fs(?=[^a-z]|$)|功能说明|功能规格/.test(s))return TYPES[0];if(/技术(?:说明|文档)|开发(?:技术)?(?:说明|文档)/.test(s))return '技术说明';if(/交接|handover/.test(s))return TYPES[1];if(/设计|(^|[^a-z])ts(?=[^a-z]|$)|technical.design/.test(s))return TYPES[2];if(/测试|验收|test/.test(s))return TYPES[3];if(/会议|纪要|meeting/.test(s))return TYPES[4];if(/笔记|notes|abap/.test(s))return TYPES[5];return TYPES[6];}
module.exports={Store,within,inferType,cleanBody,plain};
