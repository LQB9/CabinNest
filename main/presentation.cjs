const {BrowserWindow,Tray,Menu,nativeImage,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {handleSize,floatingBounds,dockBounds}=require('./dock-position.cjs');
const {normalizeHandlePreferences}=require('./handle-preferences.cjs');
const modes=new Set(['window','edge','tray']);
function createPresentation({win,dataRoot,isTest,requestClose}){
 const preferences=path.join(dataRoot,'profile','window.json');
 let saved={};try{saved=JSON.parse(fs.readFileSync(preferences,'utf8'));}catch{}
 let mode=modes.has(saved.mode)?saved.mode:'window',handle,disposed=false,collapsed=false,handleDrag=null,backupState={};
 let windowBounds=saved.windowBounds,handlePosition=saved.handlePosition,handleSide=['left','right','top'].includes(saved.handleSide)?saved.handleSide:'right',geometryTimer,snapTimer=null,snapDone=null;
 let handlePreferences=normalizeHandlePreferences(saved.handlePreferences),idleTimer=null,opacityTimer=null,handleIdle=false,handleHovered=false;
 const icon=nativeImage.createFromPath(path.join(__dirname,'../assets/icon.png'));
 const tray=new Tray(icon.resize({width:20,height:20}));tray.setToolTip('CabinNest · 资料与待办');
 const getState=()=>({mode,visible:win.isVisible(),collapsed,minimized:win.isMinimized(),trayAvailable:!tray.isDestroyed(),handlePreferences:{...handlePreferences}});
 const notify=()=>{if(!win.isDestroyed())win.webContents.send('desk:presentation',getState());};
 function save(){fs.mkdirSync(path.dirname(preferences),{recursive:true});fs.writeFileSync(preferences,JSON.stringify({mode,windowBounds,handlePosition,handleSide,handlePreferences},null,2));}
 const getHandleState=()=>({side:handleSide,dragging:!!handleDrag?.moved,snapping:!!snapTimer,idle:handleIdle,preferences:{...handlePreferences}});
 function notifyHandle(){if(handle&&!handle.isDestroyed())handle.webContents.send('desk:handle-state',getHandleState());}
 function stopOpacity(){clearTimeout(opacityTimer);opacityTimer=null;}
 function wakeHandle(){clearTimeout(idleTimer);idleTimer=null;stopOpacity();handleIdle=false;if(handle&&!handle.isDestroyed())handle.setOpacity(1);notifyHandle();}
 function fadeHandle(){
  if(disposed||!collapsed||!handle?.isVisible()||handleDrag||handleHovered||!handlePreferences.fadeEnabled)return;
  stopOpacity();handleIdle=true;notifyHandle();const start=handle.getOpacity(),began=Date.now();
  const tick=()=>{if(disposed||!handle||handle.isDestroyed())return;const progress=Math.min(1,(Date.now()-began)/200);handle.setOpacity(start+(handlePreferences.idleOpacity-start)*progress);if(progress<1)opacityTimer=setTimeout(tick,16);else opacityTimer=null;};tick();
 }
 function scheduleIdle(){clearTimeout(idleTimer);idleTimer=null;if(!disposed&&collapsed&&handle?.isVisible()&&!handleDrag&&!handleHovered&&handlePreferences.fadeEnabled)idleTimer=setTimeout(()=>{idleTimer=null;fadeHandle();},handlePreferences.idleSeconds*1000);}
 function cursorOnHandle(){if(!handle||handle.isDestroyed())return false;const p=screen.getCursorScreenPoint(),b=handle.getBounds();return p.x>=b.x&&p.x<b.x+b.width&&p.y>=b.y&&p.y<b.y+b.height;}
 function handleActivity(value={}){if(!collapsed||!handle?.isVisible())return;if(typeof value?.hovered==='boolean')handleHovered=value.hovered;wakeHandle();scheduleIdle();}
 function setHandlePreferences(value){handlePreferences=normalizeHandlePreferences({...handlePreferences,...value});save();wakeHandle();scheduleIdle();notify();return getState();}
 function stopSnap(){if(snapTimer)clearTimeout(snapTimer);snapTimer=null;if(snapDone){const resolve=snapDone;snapDone=null;resolve(false);}}
 function display(){return screen.getDisplayMatching(win.getBounds()).workArea;}
 function clampBounds(bounds,area){
  const width=Math.min(Math.max(780,Number(bounds?.width)||980),area.width),height=Math.min(Math.max(540,Number(bounds?.height)||680),area.height);
  return{width,height,x:Math.round(Math.min(Math.max(Number.isFinite(bounds?.x)?bounds.x:area.x+(area.width-width)/2,area.x),area.x+area.width-width)),y:Math.round(Math.min(Math.max(Number.isFinite(bounds?.y)?bounds.y:area.y+(area.height-height)/2,area.y),area.y+area.height-height))};
 }
 function layout(){
  const area=display();
  win.setMinimumSize(320,360);win.setResizable(mode==='window');win.setSkipTaskbar(win.isMinimized()?false:mode!=='window');win.setAlwaysOnTop(mode!=='window');
  if(mode==='window'){if(!win.isMaximized())win.setBounds(clampBounds(windowBounds,area));win.setMinimumSize(Math.min(780,area.width),Math.min(540,area.height));}
  if(mode==='edge')win.setBounds({x:area.x+area.width-Math.min(440,area.width),y:area.y,width:Math.min(440,area.width),height:area.height});
  if(mode==='tray'){
   const bounds=tray.getBounds(),located=bounds.width>0&&bounds.height>0;
   const trayArea=(located?screen.getDisplayMatching(bounds):screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea,width=Math.min(440,trayArea.width-16),height=Math.min(600,trayArea.height-16);
   const trayAtTop=located&&bounds.y<trayArea.y+trayArea.height/2,anchorX=located?bounds.x+bounds.width/2:trayArea.x+trayArea.width-8;
   win.setBounds({width,height,x:Math.round(Math.min(Math.max(anchorX-width/2,trayArea.x+8),trayArea.x+trayArea.width-width-8)),y:trayAtTop?trayArea.y+8:trayArea.y+trayArea.height-height-8});
  }
 }
 function ensureHandle(){
  if(handle&&!handle.isDestroyed())return handle;
  handle=new BrowserWindow({...handleSize(handleSide),frame:false,transparent:true,resizable:false,skipTaskbar:true,alwaysOnTop:true,show:false,title:'展开 CabinNest',webPreferences:{preload:path.join(__dirname,'edge-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  handle.setAlwaysOnTop(true,'floating');handle.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  handle.webContents.on('will-navigate',e=>e.preventDefault());
  handle.webContents.on('did-finish-load',notifyHandle);
  handle.loadFile(path.join(__dirname,'../renderer/edge.html'));
  return handle;
 }
 function clampHandle(position){
  const initial=display(),fallback=floatingBounds(position,initial,handleSide),x=Number.isFinite(position?.x)?position.x:fallback.x,y=Number.isFinite(position?.y)?position.y:fallback.y,{width,height}=handleSize(handleSide);
  const area=screen.getDisplayNearestPoint({x:Math.round(x+width/2),y:Math.round(y+height/2)}).workArea;
  return floatingBounds({x,y},area,handleSide);
 }
 function snapHandle(animate=false){
  stopSnap();if(!handle||handle.isDestroyed())return Promise.resolve(false);
  let start=handle.getBounds();const area=screen.getDisplayMatching(start).workArea,target=dockBounds(start,area,handleSide);handleSide=target.side;
  if(start.width!==target.width||start.height!==target.height){start=floatingBounds({x:start.x+(start.width-target.width)/2,y:start.y+(start.height-target.height)/2},area,handleSide);handle.setBounds(start);}
  const finish=()=>{handle.setBounds({x:target.x,y:target.y,width:target.width,height:target.height});handlePosition={x:target.x,y:target.y};save();notifyHandle();};
  if(!animate||start.x===target.x&&start.y===target.y){finish();return Promise.resolve(true);}
  return new Promise(resolve=>{snapDone=resolve;const began=Date.now();const tick=()=>{if(disposed||!handle||handle.isDestroyed()){stopSnap();return;}const progress=Math.min(1,(Date.now()-began)/160),eased=1-Math.pow(1-progress,3);handle.setPosition(Math.round(start.x+(target.x-start.x)*eased),Math.round(start.y+(target.y-start.y)*eased));if(progress<1)snapTimer=setTimeout(tick,12);else{snapTimer=null;snapDone=null;finish();resolve(true);}};snapTimer=setTimeout(tick,0);notifyHandle();});
 }
 function showHandle(){stopSnap();const h=ensureHandle(),bounds=clampHandle(handlePosition);h.setBounds(bounds);snapHandle();h.showInactive();handleHovered=cursorOnHandle();wakeHandle();scheduleIdle();}
 function beginHandleDrag(){if(disposed||!collapsed||!handle?.isVisible())return false;stopSnap();wakeHandle();handleDrag={point:screen.getCursorScreenPoint(),bounds:handle.getBounds(),moved:false};notifyHandle();return true;}
 function moveHandleDrag(){
  if(!handleDrag||!handle||handle.isDestroyed())return false;
  const point=screen.getCursorScreenPoint(),dx=point.x-handleDrag.point.x,dy=point.y-handleDrag.point.y;
  if(!handleDrag.moved&&Math.hypot(dx,dy)<5)return false;
  handleDrag.moved=true;const bounds=clampHandle({x:handleDrag.bounds.x+dx,y:handleDrag.bounds.y+dy});handle.setBounds(bounds);handlePosition={x:bounds.x,y:bounds.y};notifyHandle();return true;
 }
 async function endHandleDrag(){if(!handleDrag)return false;moveHandleDrag();const moved=handleDrag.moved;handleDrag=null;if(moved)await snapHandle(true);handleHovered=cursorOnHandle();wakeHandle();scheduleIdle();return moved;}
 function menu(){tray.setContextMenu(Menu.buildFromTemplate([
  {label:'打开CabinNest',click:show},{type:'separator'},
  ...[['window','独立窗口'],['edge','侧边面板'],['tray','托盘弹窗']].map(([id,label])=>({label,type:'radio',checked:mode===id,click:()=>setMode(id)})),
  {type:'separator'},{label:backupState.lastError?'自动备份失败 · 查看处理':backupState.running?'正在自动备份…':'备份与设置',click:openBackupSettings},{label:'退出',click:()=>requestClose('quit')}
 ]));}
 function openBackupSettings(){show();win.webContents.send('desk:open-backup-settings');}
 function setBackupState(state){backupState=state;if(disposed||tray.isDestroyed())return;tray.setToolTip(state.lastError?'CabinNest · 自动备份失败，请查看备份设置':state.running?'CabinNest · 正在备份资料':'CabinNest · 资料与待办');menu();}
 function alertBackupFailure(state){if(disposed||tray.isDestroyed()||isTest)return;try{tray.displayBalloon({iconType:'warning',title:'CabinNest 自动备份未完成',content:state.lastError+'\n本机资料仍保留，点击查看备份设置。',respectQuietTime:true});}catch{}}
 tray.on('balloon-click',openBackupSettings);
 function show(){if(disposed)return;stopSnap();collapsed=false;handleDrag=null;wakeHandle();handle?.hide();if(win.isMinimized())win.restore();layout();win.show();win.focus();notify();}
 function hide(toHandle=mode==='edge'){if(disposed)return;stopSnap();collapsed=toHandle;handleDrag=null;wakeHandle();win.hide();if(toHandle)showHandle();else handle?.hide();notify();}
 function minimize(){if(disposed)return;stopSnap();collapsed=false;handleDrag=null;wakeHandle();handle?.hide();win.setSkipTaskbar(false);win.minimize();notify();}
 function setMode(next){
  if(!modes.has(next))throw new Error('未知的窗口使用方式');
  if(mode==='window'&&!win.isMinimized())windowBounds=win.isMaximized()?win.getNormalBounds():win.getBounds();
  if(mode!==next&&win.isMaximized())win.unmaximize();
  mode=next;save();menu();show();return getState();
 }
 tray.on('click',()=>{if(mode==='tray'&&win.isVisible())requestClose('hide');else show();});
 tray.on('double-click',show);
 menu();layout();if(!isTest)show();
 const remember=()=>{clearTimeout(geometryTimer);geometryTimer=setTimeout(()=>{if(!disposed&&mode==='window'&&!win.isMinimized()&&!win.isMaximized()){windowBounds=win.getBounds();save();}},200);};
 win.on('resize',remember);win.on('move',remember);
 const onMinimize=()=>{collapsed=false;wakeHandle();handle?.hide();win.setSkipTaskbar(false);notify();};
 const onRestore=()=>{if(!disposed){win.setSkipTaskbar(mode!=='window');notify();}};
 win.on('minimize',onMinimize);win.on('restore',onRestore);
 const reposition=()=>{if(mode!=='window'&&!win.isMinimized())layout();if(collapsed)showHandle();};
 screen.on('display-metrics-changed',reposition);screen.on('display-removed',reposition);
 return{getState,setMode,show,hide,collapse:()=>hide(true),notify,getHandleState,beginHandleDrag,moveHandleDrag,endHandleDrag,handleActivity,setHandlePreferences,setBackupState,alertBackupFailure,
  isHandleSender:event=>handle&&!handle.isDestroyed()&&event.sender===handle.webContents&&event.senderFrame===handle.webContents.mainFrame,
  action(action){if(action==='minimize')minimize();else if(action==='maximize'){if(mode==='window')win.isMaximized()?win.unmaximize():win.maximize();}else if(action==='close')requestClose('hide');else if(action==='quit')requestClose('quit');else throw new Error('未知的窗口操作');return getState();},
  dispose(){disposed=true;stopSnap();handleDrag=null;clearTimeout(geometryTimer);clearTimeout(idleTimer);stopOpacity();win.removeListener('minimize',onMinimize);win.removeListener('restore',onRestore);screen.removeListener('display-metrics-changed',reposition);screen.removeListener('display-removed',reposition);if(handle&&!handle.isDestroyed())handle.destroy();if(!tray.isDestroyed())tray.destroy();}
 };
}
module.exports={createPresentation};
