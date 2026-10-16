const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke=(channel)=>(...args)=>ipcRenderer.invoke(channel,...args);
contextBridge.exposeInMainWorld('desk', {
  bootstrap:invoke('desk:bootstrap'),search:invoke('desk:search'),getDocument:invoke('desk:get-document'),
  saveProject:invoke('desk:save-project'),createNote:invoke('desk:create-note'),updateDocument:invoke('desk:update-document'),
  saveRequirement:invoke('desk:save-requirement'),assignRequirement:invoke('desk:assign-requirement'),
  chooseImport:invoke('desk:import'),saveTask:invoke('desk:save-task'),trash:invoke('desk:trash'),
  importDroppedFiles(files,options){
    if(!Array.isArray(files)||!files.length)throw new Error('请从文件管理器拖入文件');
    const paths=files.map(file=>webUtils.getPathForFile(file));
    if(paths.some(p=>!p))throw new Error('请从文件管理器拖入本地文件');
    return ipcRenderer.invoke('desk:import-dropped',{paths,projectId:options?.projectId,requirementId:options?.requirementId});
  },
  snapshot:invoke('desk:snapshot'),restoreVersion:invoke('desk:restore-version'),fileData:invoke('desk:file-data'),
  fileUrl:invoke('desk:file-url'),openFile:invoke('desk:open-file'),collectEdit:invoke('desk:collect-edit'),
  viewerHtml:invoke('desk:viewer-html'),
  exportDocument:invoke('desk:export-document'),backup:invoke('desk:backup'),restoreBackup:invoke('desk:restore-backup'),
  exportProject:invoke('desk:export-project'),chooseProjectArchive:invoke('desk:choose-project-archive'),importProjectArchive:invoke('desk:import-project-archive'),revealProjectArchive:invoke('desk:reveal-project-archive'),
  onArchiveProgress(callback){const fn=(_event,progress)=>callback(progress);ipcRenderer.on('desk:archive-progress',fn);return()=>ipcRenderer.removeListener('desk:archive-progress',fn);},
  revealData:invoke('desk:reveal-data'),
  getPresentation:invoke('desk:get-presentation'),setPresentation:invoke('desk:set-presentation'),collapse:invoke('desk:collapse'),windowAction:invoke('desk:window-action'),
  onPresentation(callback){const fn=(_event,state)=>callback(state);ipcRenderer.on('desk:presentation',fn);return()=>ipcRenderer.removeListener('desk:presentation',fn);},
  onChanged(callback){const fn=()=>callback();ipcRenderer.on('desk:changed',fn);return()=>ipcRenderer.removeListener('desk:changed',fn);},
  onSaveRequest(callback){const fn=()=>callback();ipcRenderer.on('desk:request-save',fn);return()=>ipcRenderer.removeListener('desk:request-save',fn);},
  readyToClose(){ipcRenderer.send('desk:ready-close');},cancelClose(){ipcRenderer.send('desk:cancel-close');}
});
