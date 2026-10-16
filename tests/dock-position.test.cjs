const test=require('node:test'),assert=require('node:assert/strict');
const {HANDLE_SIZE,TOP_HANDLE_SIZE,floatingBounds,dockBounds}=require('../main/dock-position.cjs');
const area={x:0,y:0,width:1920,height:1040};
test('松手后吸附最近的左右边缘，并保留拖动高度',()=>{
 assert.deepEqual(dockBounds({x:180,y:280},area),{x:0,y:280,...HANDLE_SIZE,side:'left'});
 assert.deepEqual(dockBounds({x:1700,y:640},area),{x:1888,y:640,...HANDLE_SIZE,side:'right'});
});
test('拖动过程中可自由经过屏幕中部，松手时再贴边',()=>{
 assert.equal(floatingBounds({x:840,y:360},area).x,840);assert.equal(dockBounds({x:840,y:360},area).x,0);
});
test('顶部、底部和屏幕外位置均保留可点击范围',()=>{
 assert.deepEqual(dockBounds({x:-10000,y:-10000},area),{x:0,y:0,...HANDLE_SIZE,side:'left'});
 assert.deepEqual(dockBounds({x:10000,y:10000},area),{x:1888,y:976,...HANDLE_SIZE,side:'right'});
});
test('支持左侧副屏和非零工作区偏移',()=>{
 const monitor={x:-2560,y:-200,width:2560,height:1400};assert.equal(dockBounds({x:-2300,y:400},monitor).x,-2560);assert.equal(dockBounds({x:-300,y:400},monitor).x,-32);
 const taskbar={x:48,y:40,width:1872,height:1000};assert.deepEqual(dockBounds({x:100,y:20},taskbar),{x:84,y:40,...TOP_HANDLE_SIZE,side:'top'});
});
test('旧的自由悬浮位置自动贴边，无位置时默认为右侧',()=>{
 assert.equal(dockBounds({x:500,y:300},area).side,'left');assert.deepEqual(dockBounds(undefined,area),{x:1888,y:488,...HANDLE_SIZE,side:'right'});
});
test('靠近顶部时横向吸附，重新贴边不漂移，向下拖离顶部可回到侧边',()=>{
 let top=dockBounds({x:800,y:10},area);assert.deepEqual(top,{x:784,y:0,...TOP_HANDLE_SIZE,side:'top'});
 for(let i=0;i<20;i++)top=dockBounds(top,area,'top');assert.deepEqual(top,{x:784,y:0,...TOP_HANDLE_SIZE,side:'top'});
 assert.deepEqual(dockBounds({x:784,y:200},area,'top'),{x:0,y:184,...HANDLE_SIZE,side:'left'});
});
