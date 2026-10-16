const DEFAULT_HANDLE_PREFERENCES=Object.freeze({fadeEnabled:true,idleSeconds:5,idleOpacity:.3});
function normalizeHandlePreferences(value){
 const v=value&&typeof value==='object'?value:{},number=(n,fallback,min,max)=>Number.isFinite(Number(n))?Math.min(max,Math.max(min,Number(n))):fallback;
 return{fadeEnabled:typeof v.fadeEnabled==='boolean'?v.fadeEnabled:DEFAULT_HANDLE_PREFERENCES.fadeEnabled,idleSeconds:Math.round(number(v.idleSeconds,5,2,60)),idleOpacity:Math.round(number(v.idleOpacity,.3,.1,.8)*100)/100};
}
module.exports={DEFAULT_HANDLE_PREFERENCES,normalizeHandlePreferences};
