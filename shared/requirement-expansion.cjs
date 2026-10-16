const EXPANSION_KEY='cabinnest.requirementExpansion.v1';
function readExpansion(raw){
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))return{};const result={};for(const[projectId,record]of Object.entries(value)){if(!record||typeof record!=='object')continue;const overrides={};for(const[id,expanded]of Object.entries(record.overrides||{}))if(typeof expanded==='boolean')overrides[id]=expanded;result[projectId]={defaultExpanded:record.defaultExpanded!==false,overrides};}return result;}catch{return{};}
}
function isExpanded(state,projectId,requirementId){const project=state[projectId];return typeof project?.overrides?.[requirementId]==='boolean'?project.overrides[requirementId]:project?.defaultExpanded!==false;}
function setExpanded(state,projectId,requirementId,expanded){const current=state[projectId]||{defaultExpanded:true,overrides:{}};return{...state,[projectId]:{...current,overrides:{...current.overrides,[requirementId]:!!expanded}}};}
function setAllExpanded(state,projectId,expanded){return{...state,[projectId]:{defaultExpanded:!!expanded,overrides:{}}};}
module.exports={EXPANSION_KEY,readExpansion,isExpanded,setExpanded,setAllExpanded};
