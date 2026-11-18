import fs from 'node:fs';
const P = '$WORKSPACE/arena-video/script/口播稿.md';
const CPS = 3.74;
let txt = fs.readFileSync(P, 'utf8');
const marks = [...txt.matchAll(/^### (\d\d) /gm)].map((m) => ({ n: m[1], idx: m.index }));
const end = txt.indexOf('## 撤出画面的技术细节');
const changed = [];
for (let i = marks.length - 1; i >= 0; i--) {
  const stop = i + 1 < marks.length ? marks[i + 1].idx : end;
  const body = txt.slice(marks[i].idx, stop);
  const spoken = (body.split('**口播')[1] || '').replace(/^[^\n]*\n/, '');
  const chars = spoken.replace(/\s/g, '').length;
  const sec = Math.round(chars / CPS);
  changed.unshift(marks[i].n + ' ' + chars + '字 ' + sec + 's');
  txt = txt.slice(0, marks[i].idx) +
    txt.slice(marks[i].idx, stop).replace(/\*\*口播(?:（\d+ 秒）)?\*\*/, '**口播（' + sec + ' 秒）**') +
    txt.slice(stop);
}
fs.writeFileSync(P, txt);
console.log(changed.join('\n'));
