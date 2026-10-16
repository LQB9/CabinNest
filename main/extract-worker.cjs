const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const mammoth = require('mammoth');
(async () => {
  const { filename, ext } = workerData;
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filename });
    parentPort.postMessage({ text: result.value, state: 'ready' });
  } else if (['.txt','.md','.csv','.json','.xml','.abap','.sql','.sh','.log','.html','.htm'].includes(ext)) {
    const raw = fs.readFileSync(filename);
    let result;
    try { result = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
    catch { result = new TextDecoder('gb18030').decode(raw); }
    parentPort.postMessage({ text: result, state: 'ready' });
  } else parentPort.postMessage({ text: '', state: 'metadata' });
})().catch(error => parentPort.postMessage({ text: '', state: 'failed', error: error.message }));
