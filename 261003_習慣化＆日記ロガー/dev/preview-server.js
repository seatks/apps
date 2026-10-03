// 画面の確認用サーバー。gas/index.html を配信し、google.script.run の呼び出しを
// 偽の GAS（fake-gas.js）上の gas/*.gs に中継する。サンプルとして45日分の記録を入れておく。
// 実行：node dev/preview-server.js [ポート]  → http://localhost:8080/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./fake-gas');

const PORT = Number(process.argv[2]) || 8080;
const TODAY = '2026-10-03';
const g = createGas();
const G = g.ctx;

// ---- サンプルデータ ----
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const COMMENTS = {
  i1: ['過去問 午前20問', '午後 問3を復習', 'テキスト2章'],
  i2: ['BGP の経路制御', 'OSPF の LSA を整理', 'ラボで VLAN 設定'],
  i3: ['セクション4まで', 'Docker講座 30分'],
  i4: ['「達人プログラマー」1章', '30ページ'],
  i5: ['集中できた一日。明日は早起きする', '会議が多く疲れた\n夜は短めに勉強', '週の振り返り：資格の勉強時間が足りない'],
};
const ymd = d => d.toISOString().slice(0, 10);
const start = new Date(Date.UTC(2026, 7, 20)); // 2026-08-20
g.setNow('2026-08-20 08:00');
G.setup();
for (let d = new Date(start); ymd(d) < TODAY; d.setUTCDate(d.getUTCDate() + 1)) {
  const date = ymd(d);
  g.setNow(date + ' 21:00');
  if (date === '2026-09-15') G.addItem('筋トレ');
  if (rnd() < 0.12) continue; // 開かなかった日
  const trend = 0.35 + 0.4 * ((d - start) / (45 * 864e5));
  G.getAppData().items.filter(it => it.start <= date && !it.end).forEach(it => {
    const done = rnd() < trend;
    const list = COMMENTS[it.id];
    const comment = list && rnd() < (it.id === 'i5' ? 0.6 : 0.25) ? list[Math.floor(rnd() * list.length)] : '';
    if (done || comment) G.saveEntry(date, it.id, done, comment);
  });
}
g.setNow(TODAY + ' 21:30');
G.saveEntry(TODAY, 'i1', true, '過去問 午前 R7秋 1〜20');

const mock = `<script>
window.google = { script: { run: (function make(ok, ng) {
  return new Proxy({}, { get: function (_, fn) {
    if (fn === 'withSuccessHandler') return function (f) { return make(f, ng); };
    if (fn === 'withFailureHandler') return function (f) { return make(ok, f); };
    return function () {
      var args = Array.prototype.slice.call(arguments);
      setTimeout(function () {
        fetch('/api/' + fn, { method: 'POST', body: JSON.stringify(args) }).then(function (r) { return r.json(); })
          .then(function (r) { if (r.error) { ng && ng(new Error(r.error)); } else { ok && ok(r.result); } });
      }, 300);
    };
  } });
})() } };
</script>`;

const ALLOWED = ['getAppData', 'saveEntry', 'addItem', 'renameItem', 'moveItem', 'endItem', 'exportRange'];
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    const fn = req.url.slice(5);
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try {
        if (!ALLOWED.includes(fn)) throw new Error('unknown: ' + fn);
        out = { result: G[fn](...JSON.parse(body)) };
      } catch (e) {
        out = { error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out === undefined ? {} : out));
    });
    return;
  }
  if (req.url === '/__time') { // 日付の切り替えを試すため
    g.setNow('2026-10-04 00:10');
    res.end('ok');
    return;
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'gas', 'index.html'), 'utf8').replace('<head>', '<head>' + mock);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(PORT, () => console.log('http://localhost:' + PORT + '/'));
