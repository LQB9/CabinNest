const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeHandlePreferences}=require('../main/handle-preferences.cjs');
test('旧安装默认闲置 5 秒后显示为 30% 可见度，异常配置有稳定回退',()=>{
 assert.deepEqual(normalizeHandlePreferences(),{fadeEnabled:true,idleSeconds:5,idleOpacity:.3});assert.deepEqual(normalizeHandlePreferences({idleSeconds:Infinity,idleOpacity:'bad'}),normalizeHandlePreferences());
});
test('秒数与可见度限制在可操作范围，可关闭淡化并保留有效配置',()=>{
 assert.deepEqual(normalizeHandlePreferences({idleSeconds:-10,idleOpacity:0}),{fadeEnabled:true,idleSeconds:2,idleOpacity:.1});
 assert.deepEqual(normalizeHandlePreferences({fadeEnabled:false,idleSeconds:999,idleOpacity:2}),{fadeEnabled:false,idleSeconds:60,idleOpacity:.8});
});
