const {parentPort,workerData}=require('node:worker_threads');
try{parentPort.postMessage({result:require('./backup-files.cjs').makeAutomaticBackup(workerData)});}catch(e){parentPort.postMessage({error:e.message});}
