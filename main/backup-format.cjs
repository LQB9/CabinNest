const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const MAX_COMPRESSED_FILE = 250 * 1024 * 1024;

function safePath(root, name) {
  if (typeof name !== 'string' || !/^(files|editing)[/\\]/.test(name) || path.isAbsolute(name) || name.split(/[/\\]/).some(p => !p || p === '..' || p === '.')) throw new Error('备份附件路径无效');
  const target = path.resolve(root, name);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('备份附件路径越界');
  return target;
}
function inspectTree(root, visit = () => {}) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('备份中含有链接');
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const filename = path.join(root, e.name);
    if (e.isSymbolicLink()) throw new Error('备份中含有链接');
    if (e.isDirectory()) inspectTree(filename, visit);
    else if (e.isFile()) visit(filename);
    else throw new Error('备份文件类型无效');
  }
}

// Each snapshot remains self-contained; no links to other snapshots or shared blobs.
function compressSnapshot(root) {
  const compressedFiles = []; let originalBytes = fs.statSync(path.join(root, 'projectdesk.sqlite')).size, storedBytes = originalBytes;
  for (const dir of ['files', 'editing']) inspectTree(path.join(root, dir), filename => {
    const size = fs.statSync(filename).size; originalBytes += size;
    if (size < 32768 || size > MAX_COMPRESSED_FILE) { storedBytes += size; return; }
    const bytes = fs.readFileSync(filename), compressed = gzipSync(bytes, { level: 6 });
    if (compressed.length + 1024 >= size * 0.9) { storedBytes += size; return; }
    const relative = path.relative(root, filename).split(path.sep).join('/');
    const storedPath = path.posix.dirname(relative) + '/.cn-gzip-' + crypto.randomUUID();
    fs.writeFileSync(safePath(root, storedPath), compressed, { flag: 'wx' });
    compressedFiles.push({ path: relative, storedPath, size, sha256: hash(bytes), storedSha256: hash(compressed) });
    fs.unlinkSync(safePath(root, relative)); storedBytes += compressed.length;
  });
  return { compressedFiles, originalBytes, storedBytes, savedBytes: originalBytes - storedBytes };
}

function prepareBackupRestore(source, dataRoot) {
  const input = path.resolve(source), manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf8'));
  if (manifest.app !== 'projectdesk' || ![1, 2, 3].includes(manifest.schema)) throw new Error('不是有效的CabinNest备份');
  if (manifest.schema !== 3) return { path: input, cleanup() {} };
  if (manifest.encoding !== 'gzip-files' || !Array.isArray(manifest.compressedFiles) || manifest.compressedFiles.length > 100000) throw new Error('压缩备份清单无效');
  inspectTree(input);
  const dbFile = path.join(input, 'projectdesk.sqlite');
  if (hash(fs.readFileSync(dbFile)) !== manifest.databaseSha256) throw new Error('备份数据库校验失败');
  const entries = [], paths = new Set(), storedPaths = new Set();
  for (const e of manifest.compressedFiles) {
    const destination = safePath(input, e.path), stored = safePath(input, e.storedPath);
    if (!Number.isSafeInteger(e.size) || e.size < 0 || e.size > MAX_COMPRESSED_FILE || !/^[a-f0-9]{64}$/.test(e.sha256) || !/^[a-f0-9]{64}$/.test(e.storedSha256) || paths.has(destination.toLowerCase()) || storedPaths.has(stored.toLowerCase()) || fs.existsSync(destination)) throw new Error('压缩备份清单无效');
    paths.add(destination.toLowerCase()); storedPaths.add(stored.toLowerCase()); entries.push(e);
  }
  if ([...paths].some(p => storedPaths.has(p))) throw new Error('压缩备份路径冲突');
  const parent = fs.realpathSync(dataRoot), stage = path.join(parent, '.backup-input-' + crypto.randomUUID());
  const cleanup = () => { if (fs.existsSync(stage)) { if (fs.realpathSync(stage) !== stage || !stage.startsWith(parent + path.sep)) throw new Error('恢复暂存路径已变化'); inspectTree(stage); fs.rmSync(stage, { recursive: true, force: true }); } };
  try {
    fs.cpSync(input, stage, { recursive: true, filter: src => !storedPaths.has(path.resolve(src).toLowerCase()) });
    for (const e of entries) {
      const compressed = fs.readFileSync(safePath(input, e.storedPath));
      if (hash(compressed) !== e.storedSha256) throw new Error('压缩备份附件校验失败');
      let bytes; try { bytes = gunzipSync(compressed, { maxOutputLength: Math.max(1, e.size) }); } catch { throw new Error('压缩备份附件损坏'); }
      if (bytes.length !== e.size || hash(bytes) !== e.sha256) throw new Error('压缩备份附件校验失败');
      const target = safePath(stage, e.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ ...manifest, schema: 2 }));
    return { path: stage, cleanup };
  } catch (e) { cleanup(); throw e; }
}
module.exports = { compressSnapshot, prepareBackupRestore };
