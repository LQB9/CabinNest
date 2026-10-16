const test=require('node:test'),assert=require('node:assert/strict');
const {readExpansion,isExpanded,setExpanded,setAllExpanded}=require('../shared/requirement-expansion.cjs');
test('项目独立记住全部折叠及单个展开，序列化后仍恢复，新需求采用项目默认值',()=>{
 let state=setAllExpanded({},'A',false);state=setExpanded(state,'A','r1',true);state=readExpansion(JSON.stringify(state));
 assert.equal(isExpanded(state,'A','r1'),true);assert.equal(isExpanded(state,'A','r2'),false);assert.equal(isExpanded(state,'A','new'),false);assert.equal(isExpanded(state,'B','r1'),true);
});
test('全部展开清除单个折叠覆盖，其他项目和输入状态保持不变',()=>{
 const before=setExpanded(setAllExpanded({},'B',false),'A','r1',false),after=setAllExpanded(before,'A',true);
 assert.equal(isExpanded(after,'A','r1'),true);assert.equal(isExpanded(after,'A','new'),true);assert.equal(isExpanded(after,'B','new'),false);assert.equal(isExpanded(before,'A','r1'),false);
});
test('旧安装及损坏的偏好数据安全回退为展开，忽略非布尔的单项设置',()=>{
 for(const raw of [null,'broken','[]','null'])assert.deepEqual(readExpansion(raw),{});
 const state=readExpansion('{"A":{"defaultExpanded":false,"overrides":{"r1":"yes","r2":true}}}');assert.equal(isExpanded(state,'A','r1'),false);assert.equal(isExpanded(state,'A','r2'),true);
});
