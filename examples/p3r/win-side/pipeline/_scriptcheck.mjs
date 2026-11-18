import fs from 'node:fs';
const P = '$WORKSPACE/arena-video/script/口播稿.md';
const txt = fs.readFileSync(P, 'utf8');

const banned = ['补时', '8 分 05', '3 分 18', '冻结', '第 1 集', '第 2 集', '第 3 集', '三集', '第一集', '第二集', '第三集'];
const hit = banned.filter((w) => txt.includes(w));
console.log('禁词命中: ' + (hit.length ? hit.join(' / ') : '无'));

const pageRe = /^### (\d\d) /gm;
const marks = [...txt.matchAll(pageRe)].map((m) => ({ n: m[1], idx: m.index }));
console.log('页数: ' + marks.length + '  编号: ' + marks.map((m) => m.n).join(','));
const nums = marks.map((m) => Number(m.n));
let gap = [];
for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) gap.push('第' + (i + 1) + '个位置是 ' + nums[i]);
console.log('编号连续: ' + (gap.length ? '不连续 ' + gap.join(';') : '是'));

// 逐页：屏幕字总字符、口播字数
for (let i = 0; i < marks.length; i++) {
  const start = marks[i].idx;
  const end = i + 1 < marks.length ? marks[i + 1].idx : txt.indexOf('## 撤出画面的技术细节');
  const body = txt.slice(start, end);
  const title = body.split('\n')[0].replace(/^### /, '');
  const screen = [...body.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  // 屏幕字 = **屏幕字** 那一行里的反引号内容
  const line = (body.match(/\*\*屏幕字\*\*：(.*)/) || [])[1] || '';
  const chips = [...line.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  const sc = chips.join(' ');
  const sp = (body.match(/\*\*口播（(\d+) 秒）\*\*/) || [])[1];
  const spoken = body.split('**口播')[1] || '';
  const spokenBody = spoken.replace(/^[^\n]*\n/, '').replace(/^---[\s\S]*$/, '');
  const chars = spokenBody.replace(/\s/g, '').length;
  const flag = sc.length > 80 ? '  <<< 屏幕字超 80' : '';
  console.log(String(nums[i]) + ' ' + title.slice(0, 26).padEnd(28) + ' 屏幕字 ' + String(sc.length).padStart(3) + ' | 口播 ' + String(chars).padStart(4) + ' 字 ≈ ' + (chars / 3.74).toFixed(0) + 's（标注 ' + (sp || '-') + 's）' + flag);
}
const total = marks.map((m, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].idx : txt.indexOf('## 撤出画面的技术细节');
  const body = txt.slice(m.idx, end);
  const spoken = (body.split('**口播')[1] || '').replace(/^[^\n]*\n/, '').replace(/^---[\s\S]*$/, '');
  return spoken.replace(/\s/g, '').length;
});
const sum = total.reduce((a, b) => a + b, 0);
console.log('口播合计 ' + sum + ' 字 ≈ ' + (sum / 3.74 / 60).toFixed(1) + ' 分钟纯解说');
