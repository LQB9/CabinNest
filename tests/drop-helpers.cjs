// CDP creates disk-backed File objects, exercising the real sandbox/preload bridge.
async function fileDrag(page,locator,files){
 await locator.scrollIntoViewIfNeeded();const rect=await locator.boundingBox(),point={x:rect.x+rect.width/2,y:rect.y+Math.min(rect.height/2,40)},data={items:[],files,dragOperationsMask:1};
 const session=await page.context().newCDPSession(page);
 await session.send('Input.dispatchDragEvent',{type:'dragEnter',...point,data});
 await session.send('Input.dispatchDragEvent',{type:'dragOver',...point,data});
 return{drop:async()=>{try{await session.send('Input.dispatchDragEvent',{type:'drop',...point,data});}finally{await session.detach();}},leave:async()=>{try{await session.send('Input.dispatchDragEvent',{type:'dragCancel',...point,data});}finally{await session.detach();}}};
}
module.exports={fileDrag};
