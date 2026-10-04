// サーバー側（gas/Code.gs）の動作確認。実行：node dev/test-server.js
'use strict';
const assert = require('assert');
const { createGas } = require('./fake-gas');

const g = createGas();
const G = g.ctx;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const csvOf = name => {
  const f = g.folders[0].files.find(x => x.name === name && !x.trashed);
  assert.ok(f, 'ファイルがない: ' + name);
  return f.content;
};

test('日付の計算', () => {
  assert.strictEqual(G.addDays_('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(G.addDays_('2028-03-01', -1), '2028-02-29');
  assert.strictEqual(G.mondayOf_('2026-10-04'), '2026-09-28'); // 日曜 → 前の月曜
  assert.strictEqual(G.mondayOf_('2026-09-28'), '2026-09-28');
  assert.strictEqual(G.weekdayOf_('2026-10-03'), '土');
  assert.ok(G.isYmd_('2026-02-28'));
  assert.ok(!G.isYmd_('2026-02-30'));
  assert.ok(!G.isYmd_('2026/02/01'));
});

test('CSV の形式（BOM・引用符・改行）', () => {
  const csv = G.buildCsv_([{ date: '2026-10-03', name: '読書', done: true, comment: '「a"b」\n2行目' }]);
  assert.strictEqual(csv,
    '﻿"日付","曜日","項目名","実施","コメント"\r\n"2026-10-03","土","読書","1","「a""b」\n2行目"\r\n');
});

test('setup：フォルダ・スプレッドシート・デフォルト5項目・トリガー', () => {
  g.setNow('2026-10-01 10:00'); // 木曜
  G.setup();
  assert.strictEqual(g.folders.length, 1);
  assert.strictEqual(g.folders[0].name, '習慣化ログ');
  const d = G.getAppData();
  assert.strictEqual(d.today, '2026-10-01');
  assert.deepStrictEqual(d.items.map(i => i.name), ['資格', '通信スキルアップ', 'Udemy', '読書', '日記（振返り）']);
  assert.strictEqual(d.days.length, 1);
  assert.strictEqual(g.triggers.length, 1);
  assert.strictEqual(g.triggers[0].fn, 'dailyJob');
  // 再実行しても重複しない
  G.setup();
  assert.strictEqual(g.folders.length, 1);
  assert.strictEqual(g.triggers.length, 1);
  assert.strictEqual(G.getAppData().items.length, 5);
});

test('当日の保存・上書き・数式になる文字の扱い', () => {
  G.saveEntry('2026-10-01', 'i1', true, '過去問 20問');
  G.saveEntry('2026-10-01', 'i1', true, '過去問 30問'); // 追記・修正
  G.saveEntry('2026-10-01', 'i5', false, '=SUM(1) は数式にしない');
  G.saveEntry('2026-10-01', 'i2', true, '');
  const d = G.getAppData();
  const t = d.days[0];
  assert.strictEqual(t.done, 2);
  assert.strictEqual(t.total, 5);
  assert.deepStrictEqual(t.cells.i1, [1, '過去問 30問']);
  assert.deepStrictEqual(t.cells.i5, [0, '=SUM(1) は数式にしない']);
  assert.strictEqual(g.spreadsheets[g.props.SS_ID].getSheetByName('records').rows.length, 4); // 見出し＋3行
});

test('日付が違う保存は拒否（DATE_CHANGED）', () => {
  assert.throws(() => G.saveEntry('2026-09-30', 'i1', true, ''), /DATE_CHANGED/);
});

test('名称変更：今日の記録の項目名も変わる', () => {
  const d = G.renameItem('i2', '通信');
  assert.strictEqual(d.items.find(i => i.id === 'i2').name, '通信');
  assert.throws(() => G.renameItem('i3', '読書'), /同じ名前/);
});

test('0時台の自動処理で前日を確定（未入力の項目は 0 で行を作る）', () => {
  g.setNow('2026-10-02 00:05');
  G.dailyJob();
  const d = G.getAppData();
  assert.strictEqual(d.today, '2026-10-02');
  const y = d.days.find(x => x.date === '2026-10-01');
  assert.strictEqual(y.done, 2);
  assert.strictEqual(y.total, 5);
  assert.strictEqual(y.live, undefined);
  assert.strictEqual(Object.keys(y.cells).length, 5);
  const t = d.days.find(x => x.date === '2026-10-02');
  assert.ok(t.live);
  assert.strictEqual(t.done, 0);
  assert.deepStrictEqual(t.cells, {});
});

test('項目の追加・終了・並べ替え', () => {
  let d = G.addItem('ジム');
  const gym = d.items.find(i => i.name === 'ジム');
  assert.strictEqual(gym.start, '2026-10-02');
  d = G.endItem('i4'); // 読書：今日まで有効
  assert.strictEqual(d.items.find(i => i.id === 'i4').end, '2026-10-02');
  assert.strictEqual(d.days[d.days.length - 1].total, 6);
  d = G.moveItem(gym.id, -1);
  const order = d.items.filter(i => !i.end).sort((a, b) => a.order - b.order).map(i => i.name);
  assert.deepStrictEqual(order, ['資格', '通信', 'Udemy', 'ジム', '日記（振返り）']);
  // 今日追加した項目の終了 → 今日からすぐ外れる
  d = G.addItem('一時');
  const tmp = d.items.find(i => i.name === '一時');
  d = G.endItem(tmp.id);
  assert.strictEqual(d.days[d.days.length - 1].total, 6);
  G.saveEntry('2026-10-02', gym.id, true, 'ベンチ');
  G.saveEntry('2026-10-02', 'i4', true, '最後の読書');
  assert.throws(() => G.saveEntry('2026-10-02', tmp.id, true, ''), /入力対象ではありません/);
});

test('自動処理が止まっていても、開いたときに未確定の日と週次出力を補う', () => {
  g.setNow('2026-10-06 07:30'); // 火曜。10/3〜10/5 の自動処理は動かなかった想定
  const d = G.getAppData();
  assert.deepStrictEqual(d.days.map(x => x.date),
    ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
  const d3 = d.days.find(x => x.date === '2026-10-03');
  assert.strictEqual(d3.total, 5); // 読書は終了、ジムを追加
  assert.strictEqual(d3.done, 0);
  const d2 = d.days.find(x => x.date === '2026-10-02');
  assert.strictEqual(d2.done, 2);
  assert.strictEqual(d2.total, 6);

  const csv = csvOf('習慣化ログ_2026-09-28_2026-10-04.csv');
  const lines = csv.slice(1).trim().split('\r\n');
  assert.strictEqual(lines.length, 1 + 5 + 6 + 5 + 5); // 見出し＋10/1〜10/4
  assert.ok(lines[1].startsWith('"2026-10-01","木","資格","1","過去問 30問"'));
  assert.ok(lines.includes('"2026-10-01","木","通信","1",""')); // その日の名称
  assert.ok(lines.includes('"2026-10-02","金","読書","1","最後の読書"'));
  assert.ok(!lines.some(l => l.startsWith('"2026-10-03"') && l.includes('読書')));
  assert.strictEqual(g.props.LAST_EXPORTED_WEEK_END, '2026-10-04');
  // 同じ週を二重に出力しない
  G.dailyJob();
  assert.strictEqual(g.folders[0].files.filter(f => f.name.startsWith('習慣化ログ_2026-09-28')).length, 1);
});

test('名称変更後も、過去日の CSV はその日の名称のまま', () => {
  G.renameItem('i1', '応用情報');
  const res = G.exportRange('2026-09-01', '2026-12-31'); // 記録期間に丸める
  assert.ok(/^習慣化ログ_手動_2026-10-01_2026-10-06_出力2026-10-06-0730\.csv$/.test(res.name), res.name);
  const lines = csvOf(res.name).slice(1).trim().split('\r\n');
  assert.ok(lines.includes('"2026-10-01","木","資格","1","過去問 30問"'));
  assert.ok(lines.includes('"2026-10-06","火","応用情報","0",""')); // 当日は入力中の内容
  assert.strictEqual(res.rows, lines.length - 1);
  assert.throws(() => G.exportRange('2026-10-05', '2026-10-01'), /開始日/);
  assert.throws(() => G.exportRange('2026-01-01', '2026-02-01'), /記録がありません/);
});

test('週次出力は月曜0時台の自動処理で先週分を出す', () => {
  g.setNow('2026-10-12 00:05'); // 月曜
  G.dailyJob();
  const lines = csvOf('習慣化ログ_2026-10-05_2026-10-11.csv').slice(1).trim().split('\r\n');
  assert.strictEqual(lines.length, 1 + 7 * 5);
  assert.strictEqual(g.props.LAST_FINALIZED, '2026-10-11');
});

test('最後の1項目は終了できない', () => {
  const ids = G.getAppData().items.filter(i => !i.end).map(i => i.id);
  ids.slice(0, -1).forEach(id => G.endItem(id));
  assert.throws(() => G.endItem(ids[ids.length - 1]), /1つ以上/);
});

console.log(`\n${passed} 件すべて成功`);
