const fs=require('node:fs'),path=require('node:path');
function resolveDataRoot({override,isPackaged,executable,sourceRoot,markerPath,localAppData}){
 if(override)return path.resolve(override);
 let installed=false;try{const marker=JSON.parse(fs.readFileSync(markerPath,'utf8'));installed=marker.app==='CabinNest'&&marker.mode==='installed'&&marker.schema===1;}catch{}
 if(isPackaged&&installed){if(!localAppData||!path.isAbsolute(localAppData))throw new Error('无法确定本机应用资料目录');return path.join(localAppData,'CabinNest','data');}
 return path.resolve(isPackaged?path.dirname(executable):sourceRoot,'data');
}
module.exports={resolveDataRoot};
