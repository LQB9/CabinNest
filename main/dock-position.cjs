const HANDLE_SIZE=Object.freeze({width:32,height:64}),TOP_HANDLE_SIZE=Object.freeze({width:64,height:32});
const handleSize=side=>side==='top'?TOP_HANDLE_SIZE:HANDLE_SIZE;
function floatingBounds(position,area,side='right'){
 const {width,height}=handleSize(side),x=Number.isFinite(position?.x)?position.x:area.x+area.width-width,y=Number.isFinite(position?.y)?position.y:area.y+(area.height-height)/2;
 return{x:Math.round(Math.min(Math.max(x,area.x),area.x+Math.max(0,area.width-width))),y:Math.round(Math.min(Math.max(y,area.y),area.y+Math.max(0,area.height-height))),width,height};
}
function dockBounds(position,area,orientation='right'){
 const start=floatingBounds(position,area,orientation),cx=start.x+start.width/2,cy=start.y+start.height/2,left=cx-area.x,right=area.x+area.width-cx,top=cy-area.y;
 // Approaching the top selects it; ordinary side-to-side drags stay on the sides.
 const side=top<=Math.min(96,area.height/4)&&top<Math.min(left,right)?'top':left<right?'left':'right',{width,height}=handleSize(side),clamped=floatingBounds({x:cx-width/2,y:cy-height/2},area,side);
 return{...clamped,x:side==='left'?area.x:side==='right'?area.x+Math.max(0,area.width-width):clamped.x,y:side==='top'?area.y:clamped.y,side};
}
module.exports={HANDLE_SIZE,TOP_HANDLE_SIZE,handleSize,floatingBounds,dockBounds};
