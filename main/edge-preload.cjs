const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panel',{
 expand:()=>ipcRenderer.send('desk:expand-panel'),
 getDockState:()=>ipcRenderer.invoke('desk:get-handle-state'),
 onDockState(callback){const fn=(_event,state)=>callback(state);ipcRenderer.on('desk:handle-state',fn);return()=>ipcRenderer.removeListener('desk:handle-state',fn);},
 beginDrag:()=>ipcRenderer.invoke('desk:begin-handle-drag'),
 moveDrag:()=>ipcRenderer.send('desk:move-handle-drag'),
 endDrag:()=>ipcRenderer.invoke('desk:end-handle-drag')
});
