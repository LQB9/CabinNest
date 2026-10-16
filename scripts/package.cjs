const path=require('node:path');
(async()=>{
 const {packager}=await import('@electron/packager');
 const root=path.resolve(__dirname,'..'),out=path.resolve(root,'release');
 if(!out.startsWith(root+path.sep))throw new Error('打包目录超出项目范围');
 const fs=require('node:fs');
 const cachedZip=path.join(root,'..','electron-v44.7.2-win32-x64.zip');
 const results=await packager({dir:path.join(root,'build-app'),out,name:'CabinNest',platform:'win32',arch:'x64',electronVersion:'44.7.2',...(fs.existsSync(cachedZip)?{electronZipDir:path.dirname(cachedZip)}:{}),ignore:[/^\/data(\/|$)/],prune:false,asar:false,overwrite:true,icon:path.join(root,'assets/icon.ico'),appCopyright:'CabinNest',win32metadata:{CompanyName:'CabinNest',FileDescription:'CabinNest',ProductName:'CabinNest',InternalName:'CabinNest'},appVersion:'1.10.0',buildVersion:'1.10.0'});
 console.log('PACKAGE_OK',JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1)});
