const fsTemplate = `<h1>功能说明书</h1>
<table><tbody><tr><th>项目 / 功能编号</th><td></td><th>版本</th><td>v1.0</td></tr><tr><th>功能名称</th><td></td><th>编写人</th><td></td></tr></tbody></table>
<h2>1 业务背景与目标</h2><p>描述当前业务问题和本次功能要达到的结果。</p>
<h2>2 适用范围与边界</h2><p>说明涉及的组织、业务场景，以及不包含的范围。</p>
<h2>3 业务流程</h2><ol><li><p>触发条件与输入。</p></li><li><p>处理步骤与业务规则。</p></li><li><p>输出结果及后续动作。</p></li></ol>
<h2>4 功能规则</h2><table><tbody><tr><th>编号</th><th>场景 / 条件</th><th>处理规则</th><th>异常提示</th></tr><tr><td>R01</td><td></td><td></td><td></td></tr></tbody></table>
<h2>5 字段与界面说明</h2><table><tbody><tr><th>字段</th><th>类型 / 长度</th><th>必填</th><th>来源与校验</th></tr><tr><td></td><td></td><td></td><td></td></tr></tbody></table>
<h2>6 接口与依赖</h2><p>列明上下游系统、接口、主数据与配置依赖。</p>
<h2>7 权限与异常处理</h2><p>说明权限边界、失败场景、回退方式。</p>
<h2>8 验收标准</h2><table><tbody><tr><th>场景</th><th>操作 / 输入</th><th>预期结果</th></tr><tr><td></td><td></td><td></td></tr></tbody></table>
<h2>9 变更记录</h2><table><tbody><tr><th>版本</th><th>日期</th><th>变更内容</th><th>确认人</th></tr><tr><td>v1.0</td><td></td><td>初稿</td><td></td></tr></tbody></table>`;
const handoverTemplate = `<h1>技术交接文档</h1>
<h2>1 交接范围</h2><p>写明项目、模块、交接对象和当前完成状态。</p>
<h2>2 系统对象清单</h2><table><tbody><tr><th>对象类型</th><th>名称</th><th>用途</th><th>开发包 / 请求</th></tr><tr><td>程序 / 类 / 函数 / 表</td><td></td><td></td><td></td></tr></tbody></table>
<h2>3 处理流程与关键逻辑</h2><p>按执行顺序记录入口、关键判断、数据读写和事务提交位置。</p>
<h2>4 输入与输出</h2><table><tbody><tr><th>输入 / 输出</th><th>字段 / 文件</th><th>来源 / 去向</th><th>规则</th></tr><tr><td></td><td></td><td></td><td></td></tr></tbody></table>
<h2>5 接口与配置依赖</h2><p>列明连接配置、后台作业、权限对象和必须维护的参数。账号密码不写入交接正文。</p>
<h2>6 部署与传输</h2><ol><li><p>传输顺序与前置检查。</p></li><li><p>目标系统配置步骤。</p></li><li><p>验证与回退方式。</p></li></ol>
<h2>7 测试与验证</h2><table><tbody><tr><th>场景</th><th>测试数据</th><th>结果</th><th>相关证据</th></tr><tr><td></td><td></td><td></td><td></td></tr></tbody></table>
<h2>8 已知问题与限制</h2><p>记录尚未解决的问题、影响范围和临时处理方式。</p>
<h2>9 后续待办</h2><p>需要跟进的事项，可在右侧新建关联待办。</p>
<h2>10 相关资料</h2><p>补充 FS、设计、测试记录等对应资料名称。</p>`;
const blankTemplate = '<p></p>';
function getTemplate(type) { return type === 'FS 功能说明书' ? fsTemplate : type === '技术交接' ? handoverTemplate : blankTemplate; }
module.exports = { getTemplate };
