// 日付・CSVなど、Googleのサービスに依存しない処理
// 日付はすべて日本時間の 'yyyy-MM-dd' 文字列で扱う

const TZ = 'Asia/Tokyo';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function parseDate_(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd_(dt) {
  return dt.toISOString().slice(0, 10);
}

function addDays_(s, n) {
  const dt = parseDate_(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatYmd_(dt);
}

function weekdayOf_(s) {
  return WEEKDAYS[parseDate_(s).getUTCDay()];
}

// その日を含む週の月曜日
function mondayOf_(s) {
  const dow = parseDate_(s).getUTCDay();
  return addDays_(s, -((dow + 6) % 7));
}

// from から to まで（両端を含む）の日付の配列
function dateRange_(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays_(d, 1)) out.push(d);
  return out;
}

function isYmd_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && formatYmd_(parseDate_(s)) === s;
}

// その日に入力対象だった項目（表示順）
function activeItemsOn_(items, date) {
  return items
    .filter(it => it.start <= date && (!it.end || date <= it.end))
    .sort((a, b) => a.order - b.order);
}

// CSVの1フィールド。すべて "" で囲み、中の " は "" にする
function csvField_(v) {
  return '"' + String(v).replace(/"/g, '""') + '"';
}

// rows: [{date, name, done, comment}] → CSV文字列（Excelで文字化けしないようBOM付き、改行はCRLF）
function buildCsv_(rows) {
  const lines = [['日付', '曜日', '項目名', '実施', 'コメント'].map(csvField_).join(',')];
  rows.forEach(r => {
    lines.push([r.date, weekdayOf_(r.date), r.name, r.done ? 1 : 0, r.comment].map(csvField_).join(','));
  });
  return '﻿' + lines.join('\r\n') + '\r\n';
}
