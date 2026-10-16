const { parseDocument } = require('htmlparser2');
const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, Packer, ImageRun, BorderStyle } = require('docx');
function imageDimensions(b,format){
 try{
  if(format==='png')return[b.readUInt32BE(16),b.readUInt32BE(20)];
  if(format==='gif')return[b.readUInt16LE(6),b.readUInt16LE(8)];
  if(format==='bmp')return[Math.abs(b.readInt32LE(18)),Math.abs(b.readInt32LE(22))];
  for(let i=2;i<b.length-9;){if(b[i]!==255){i++;continue;}const marker=b[i+1],length=b.readUInt16BE(i+2);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return[b.readUInt16BE(i+7),b.readUInt16BE(i+5)];if(!length)break;i+=length+2;}
 }catch{}return[500,300];
}
function runs(nodes, styles={}) {
  const result=[];
  for(const n of nodes||[]) {
    if(n.type==='text'){result.push(new TextRun({text:n.data,...styles}));continue;}
    if(n.name==='br'){result.push(new TextRun({break:1,...styles}));continue;}
    if(n.name==='img'&&/^data:image\/(png|jpeg|jpg|gif|bmp);base64,/.test(n.attribs?.src||'')){
      const [,format,data]=n.attribs.src.match(/^data:image\/(\w+);base64,(.*)$/s);
      const bytes=Buffer.from(data,'base64'),[width,height]=imageDimensions(bytes,format),scale=Math.min(1,550/width,650/height);
      result.push(new ImageRun({data:bytes,type:format==='jpeg'?'jpg':format,transformation:{width:Math.round(width*scale),height:Math.round(height*scale)}}));continue;
    }
    const next={...styles};if(['b','strong'].includes(n.name))next.bold=true;if(['i','em'].includes(n.name))next.italics=true;if(n.name==='u')next.underline={};if(['s','strike'].includes(n.name))next.strike=true;if(n.name==='code')next.font='Consolas';
    result.push(...runs(n.children,next));
  }
  return result.length?result:[new TextRun('')];
}
function blocks(nodes, list=null) {
  const out=[];
  for(const n of nodes||[]) {
    if(n.type==='text'){if(n.data.trim())out.push(new Paragraph({children:runs([n])}));continue;}
    if(n.name==='table'){
      const rows=[];function collect(ns){for(const c of ns||[])if(c.name==='tr')rows.push(c);else if(['tbody','thead','tfoot'].includes(c.name))collect(c.children);}collect(n.children);
      const columns=Math.max(...rows.map(r=>(r.children||[]).filter(c=>['td','th'].includes(c.name)).length),1);
      out.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:Array(columns).fill(Math.floor(9000/columns)),rows:rows.map(r=>new TableRow({children:r.children.filter(c=>['td','th'].includes(c.name)).map(c=>new TableCell({children:blocks(c.children).length?blocks(c.children):[new Paragraph('')],shading:c.name==='th'?{fill:'E9EDF2'}:undefined,margins:{top:110,bottom:110,left:130,right:130},columnSpan:Number(c.attribs?.colspan)||1}))})),borders:{top:{style:BorderStyle.SINGLE,size:4,color:'D9D9D9'},bottom:{style:BorderStyle.SINGLE,size:4,color:'D9D9D9'},left:{style:BorderStyle.SINGLE,size:4,color:'D9D9D9'},right:{style:BorderStyle.SINGLE,size:4,color:'D9D9D9'},insideHorizontal:{style:BorderStyle.SINGLE,size:4,color:'D9D9D9'},insideVertical:{style:BorderStyle.SINGLE,size:4,color:'D9D9D9'}}}));continue;
    }
    if(['ul','ol'].includes(n.name)){out.push(...blocks(n.children,n.name));continue;}
    if(n.name==='li'){const content=n.children.filter(c=>!['ul','ol'].includes(c.name));out.push(new Paragraph({children:runs(content),...(list==='ul'?{bullet:{level:0}}:{numbering:{reference:'ordered',level:0}})}));out.push(...blocks(n.children.filter(c=>['ul','ol'].includes(c.name))));continue;}
    if(['div','section','tbody'].includes(n.name)){out.push(...blocks(n.children,list));continue;}
    if(['p','h1','h2','h3','h4','pre','blockquote'].includes(n.name)){
      const heading={h1:HeadingLevel.HEADING_1,h2:HeadingLevel.HEADING_2,h3:HeadingLevel.HEADING_3,h4:HeadingLevel.HEADING_4}[n.name];
      out.push(new Paragraph({children:runs(n.children,n.name==='pre'?{font:'Consolas',size:19}:{}),heading,spacing:{after:160,before:heading?200:0,line:300}}));continue;
    }
    out.push(...blocks(n.children,list));
  }
  return out;
}
async function exportDocx(html,title){
 const doc=new Document({title,creator:'CabinNest',styles:{default:{document:{run:{font:'微软雅黑',size:22,color:'202532'},paragraph:{spacing:{after:160,line:300}}}}},numbering:{config:[{reference:'ordered',levels:[{level:0,format:'decimal',text:'%1.',alignment:'left'}]}]},sections:[{properties:{page:{margin:{top:1134,bottom:1134,left:1134,right:1134}}},children:blocks(parseDocument(html).children)}]});
 return Packer.toBuffer(doc);
}
module.exports={exportDocx};
