import {renderAsync} from 'docx-preview';
const container=document.getElementById('document-container');
let zoom=1,auto=true;
function apply(){const wrapper=container.querySelector('.docx-wrapper');if(!wrapper)return;const page=wrapper.querySelector('section');if(auto&&page)zoom=Math.min(1,(document.documentElement.clientWidth-36)/page.offsetWidth);wrapper.style.zoom=String(zoom);document.getElementById('zoom-value').textContent=Math.round(zoom*100)+'%';}
document.getElementById('zoom-in').addEventListener('click',()=>{auto=false;zoom=Math.min(2,zoom+.1);apply();});
document.getElementById('zoom-out').addEventListener('click',()=>{auto=false;zoom=Math.max(.3,zoom-.1);apply();});
document.getElementById('fit').addEventListener('click',()=>{auto=true;apply();});
window.addEventListener('resize',apply);
window.addEventListener('message',async event=>{
 if(event.source!==parent||event.data?.type!=='render-docx')return;
 try{await renderAsync(event.data.data,container,null,{inWrapper:true,ignoreWidth:false,ignoreHeight:false,breakPages:true,ignoreLastRenderedPageBreak:false,renderAltChunks:false,renderChanges:false,useBase64URL:true,renderComments:false});apply();parent.postMessage({type:'docx-rendered'},'*');}
 catch(e){parent.postMessage({type:'docx-error',message:e.message},'*');}
});
document.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();});
parent.postMessage({type:'docx-ready'},'*');
