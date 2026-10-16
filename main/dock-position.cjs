const HANDLE_SIZE=Object.freeze({width:32,height:80});
function floatingBounds(position,area){
 const {width,height}=HANDLE_SIZE,x=Number.isFinite(position?.x)?position.x:area.x+area.width-width,y=Number.isFinite(position?.y)?position.y:area.y+(area.height-height)/2;
 return{x:Math.round(Math.min(Math.max(x,area.x),area.x+Math.max(0,area.width-width))),y:Math.round(Math.min(Math.max(y,area.y),area.y+Math.max(0,area.height-height))),width,height};
}
function dockBounds(position,area){
 const bounds=floatingBounds(position,area),right=area.x+Math.max(0,area.width-bounds.width),side=bounds.x-area.x<right-bounds.x?'left':'right';
 return{...bounds,x:side==='left'?area.x:right,side};
}
module.exports={HANDLE_SIZE,floatingBounds,dockBounds};
