const button=document.querySelector('button');
const updateDock=state=>{document.body.dataset.side=state.side;document.body.classList.toggle('snapping',state.snapping);button.querySelector('.chevron').textContent=state.side==='left'?'›':'‹';};
window.panel.onDockState(updateDock);window.panel.getDockState().then(updateDock).catch(()=>{});
let active=null,completedDrag=null;
button.addEventListener('pointerdown',event=>{
 if(event.button!==0||active)return;
 active={id:event.pointerId,x:event.screenX,y:event.screenY,start:window.panel.beginDrag()};completedDrag=null;
 button.setPointerCapture(event.pointerId);
});
button.addEventListener('pointermove',event=>{
 const gesture=active;if(!gesture||gesture.id!==event.pointerId)return;
 if(Math.hypot(event.screenX-gesture.x,event.screenY-gesture.y)>=5)button.classList.add('dragging');
 gesture.start.then(started=>{if(started&&active===gesture)window.panel.moveDrag();}).catch(()=>{});
});
button.addEventListener('pointerup',event=>{
 const gesture=active;if(!gesture||gesture.id!==event.pointerId)return;active=null;
 completedDrag=gesture.start.then(started=>started?window.panel.endDrag():true).catch(()=>true).finally(()=>button.classList.remove('dragging'));
 if(button.hasPointerCapture(event.pointerId))button.releasePointerCapture(event.pointerId);
});
const cancel=()=>{const gesture=active;if(!gesture)return;active=null;completedDrag=null;button.classList.remove('dragging');gesture.start.then(started=>{if(started)return window.panel.endDrag();}).catch(()=>{});};
button.addEventListener('pointercancel',cancel);button.addEventListener('lostpointercapture',cancel);
button.addEventListener('click',async event=>{
 if(event.detail===0){window.panel.expand();return;}
 const result=completedDrag;completedDrag=null;if(result&&!(await result))window.panel.expand();
});
