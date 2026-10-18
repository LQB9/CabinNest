const fs=require('node:fs'),path=require('node:path');
function isInstalled({isPackaged,markerPath}){
 if(!isPackaged)return false;
 try{const marker=JSON.parse(fs.readFileSync(markerPath,'utf8'));return marker.app==='CabinNest'&&marker.mode==='installed'&&marker.schema===1;}catch{return false;}
}
function resolveDataRoot({override,isPackaged,executable,sourceRoot,markerPath,homeDirectory}){
 if(override)return path.resolve(override);
 if(isInstalled({isPackaged,markerPath})){if(!homeDirectory||!path.isAbsolute(homeDirectory))throw new Error('无法确定本机用户资料目录');return path.join(homeDirectory,'CabinNest','data');}
 return path.resolve(isPackaged?path.dirname(executable):sourceRoot,'data');
}
function legacyDataRoots(options){
 if(options.override||!isInstalled(options)||!options.localAppData||!path.isAbsolute(options.localAppData))return[];
 const roots=[path.join(options.localAppData,'CabinNest','data')],packages=path.join(options.localAppData,'Packages');
 if(fs.existsSync(packages))for(const entry of fs.readdirSync(packages,{withFileTypes:true}))if(entry.isDirectory()&&/^OpenAI\.Codex_/i.test(entry.name))roots.push(path.join(packages,entry.name,'LocalCache','Local','CabinNest','data'));
 return roots;
}
module.exports={resolveDataRoot,legacyDataRoots,isInstalled};
