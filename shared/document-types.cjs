const TYPE_ORDER = ['FS 功能说明书', '技术说明', '技术设计', '技术交接', '测试与验收', '会议纪要', '技术笔记', '其他资料'];
const TYPE_TONES = { 'FS 功能说明书': 'fs', '技术说明': 'technical', '技术设计': 'technical', '技术交接': 'technical', '测试与验收': 'testing', '会议纪要': 'meeting', '技术笔记': 'note', '其他资料': 'other' };
const typeTone = type => TYPE_TONES[type] || 'other';
function orderDocumentsByType(documents) {
  const rank = type => { const i = TYPE_ORDER.indexOf(type); return i < 0 ? TYPE_ORDER.length : i; };
  return [...documents].sort((a, b) => rank(a.type) - rank(b.type));
}
module.exports = { TYPE_ORDER, typeTone, orderDocumentsByType };
