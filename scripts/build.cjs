const fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build-app');
async function build(){
 for(const d of ['main','renderer','assets'])fs.mkdirSync(path.join(out,d),{recursive:true});
 await esbuild.build({entryPoints:[path.join(root,'main/index.cjs')],outfile:path.join(out,'main/index.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron','node:*'],logLevel:'info'});
 await esbuild.build({entryPoints:[path.join(root,'main/extract-worker.cjs')],outfile:path.join(out,'main/extract-worker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['node:*'],logLevel:'info'});
 await esbuild.build({entryPoints:[path.join(root,'main/backup-worker.cjs')],outfile:path.join(out,'main/backup-worker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['node:*'],logLevel:'info'});
 await esbuild.build({entryPoints:[path.join(root,'renderer/app.jsx')],outfile:path.join(out,'renderer/app.js'),bundle:true,minify:true,platform:'browser',format:'iife',target:'chrome140',define:{'process.env.NODE_ENV':'"production"'},logLevel:'info'});
 await esbuild.build({entryPoints:[path.join(root,'renderer/docx-viewer.js')],outfile:path.join(out,'renderer/docx-viewer.js'),bundle:true,minify:true,platform:'browser',format:'iife',target:'chrome140',logLevel:'info'});
 for(const f of ['index.html','docx-viewer.html','docx-viewer.css','edge.html','edge.css','edge.js'])fs.copyFileSync(path.join(root,'renderer',f),path.join(out,'renderer',f));
 let viewer=fs.readFileSync(path.join(root,'renderer/docx-viewer.html'),'utf8');
 const inlineScript=fs.readFileSync(path.join(out,'renderer/docx-viewer.js'),'utf8').replace(/<\/script/gi,'<\\/script');
 const scriptHash="'sha256-"+crypto.createHash('sha256').update(inlineScript).digest('base64')+"'";
 viewer=viewer.replace("script-src 'self'",'script-src '+scriptHash).replace('<link rel="stylesheet" href="docx-viewer.css">',()=>'<style>'+fs.readFileSync(path.join(root,'renderer/docx-viewer.css'),'utf8')+'</style>').replace('<script src="docx-viewer.js"></script>',()=>'<script>'+inlineScript+'</script>');
 fs.writeFileSync(path.join(out,'renderer/docx-frame.html'),viewer);
 fs.writeFileSync(path.join(out,'renderer/index.html'),fs.readFileSync(path.join(root,'renderer/index.html'),'utf8').replace("script-src 'self'","script-src 'self' "+scriptHash));
 for(const f of ['preload.cjs','edge-preload.cjs'])fs.copyFileSync(path.join(root,'main',f),path.join(out,'main',f));
 for(const f of ['icon.png','icon.ico'])if(fs.existsSync(path.join(root,'assets',f)))fs.copyFileSync(path.join(root,'assets',f),path.join(out,'assets',f));
 fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({name:'cabinnest',productName:'CabinNest',version:require('../package.json').version,main:'main/index.cjs',description:'个人本地项目资料与待办管理',author:'CabinNest'},null,2));
 console.log('BUILD_OK',out);
}
build().catch(e=>{console.error(e);process.exit(1)});
