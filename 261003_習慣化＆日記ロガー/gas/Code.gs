// 習慣化＆日記ロガー（Google Apps Script）
// このファイル1つと index.html を、スクリプトエディタに貼り付けて使う
//   1. Webアプリの入口、画面から呼ぶ処理、初期設定（setup）と毎日の自動処理（dailyJob）
//   2. 記録用スプレッドシートの読み書き
//   3. CSV出力
//   4. 日付・CSVなどの共通処理

// ==== 1. Webアプリの入口・画面から呼ぶ処理・初期設定・自動処理 ====

const FOLDER_NAME = '習慣化ログ';
const SS_NAME = '習慣化ログ_データ';
const DEFAULT_ITEMS = ['資格', '通信スキルアップ', 'Udemy', '読書', '日記（振返り）'];
const MAX_NAME = 30;
const MAX_COMMENT = 5000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('習慣化ログ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// ---- 初期設定（スクリプトエディタから一度だけ実行する。再実行しても記録は消えない） ----

function setup() {
  const p = props_();
  const today = todayStr_();

  let folder;
  if (p.getProperty('FOLDER_ID')) {
    folder = DriveApp.getFolderById(p.getProperty('FOLDER_ID'));
  } else {
    const found = DriveApp.getRootFolder().getFoldersByName(FOLDER_NAME);
    folder = found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
  }
  p.setProperty('FOLDER_ID', folder.getId());
  p.setProperty('FOLDER_URL', folder.getUrl());

  let ss;
  if (p.getProperty('SS_ID')) {
    ss = SpreadsheetApp.openById(p.getProperty('SS_ID'));
  } else {
    ss = SpreadsheetApp.create(SS_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    ss.getSheets()[0].setName('items');
    p.setProperty('SS_ID', ss.getId());
  }

  Object.keys(SHEETS).forEach(name => {
    const cols = SHEETS[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
      sh.setFrozenRows(1);
    }
  });

  if (!p.getProperty('START_DATE')) {
    p.setProperty('START_DATE', today);
    p.setProperty('LAST_FINALIZED', addDays_(today, -1));
    p.setProperty('LAST_EXPORTED_WEEK_END', addDays_(mondayOf_(today), -1));
  }
  if (readItems_(ss).length === 0) {
    const start = p.getProperty('START_DATE');
    appendRows_(ss, 'items', DEFAULT_ITEMS.map((name, i) =>
      ({ id: 'i' + (i + 1), name, order: i + 1, start, end: '' })));
  }

  // 毎日 0時台に「前日の確定」と「週次出力」を行う
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyJob')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(0).nearMinute(5).inTimezone(TZ).create();

  Logger.log('初期設定が完了しました。フォルダ：' + folder.getUrl() + ' ／ スプレッドシート：' + ss.getUrl());
}

function dailyJob() {
  withLock_(() => {
    const ss = openSs_();
    finalizePending_(ss);
    exportPendingWeeks_(ss);
  });
}

// ---- 画面から呼ぶ処理 ----

function getAppData() {
  return withLock_(() => {
    const ss = openSs_();
    finalizePending_(ss);
    // 自動処理が動かなかった週の出力を補う（失敗しても画面は開けるようにする）
    try {
      exportPendingWeeks_(ss);
    } catch (e) {
      console.error(e);
    }
    return buildAppData_(ss);
  });
}

function buildAppData_(ss) {
  const p = props_();
  const today = todayStr_();
  const items = readItems_(ss);
  const dayMap = {};
  readDays_(ss).forEach(d => { dayMap[d.date] = d; });
  const cells = {};
  readRecords_(ss).forEach(r => {
    if (!cells[r.date]) cells[r.date] = {};
    cells[r.date][r.itemId] = [r.done ? 1 : 0, r.comment];
  });

  const days = dateRange_(p.getProperty('START_DATE'), today).map(date => {
    const c = cells[date] || {};
    if (date === today) {
      const active = activeItemsOn_(items, today);
      return { date, total: active.length, done: active.filter(it => c[it.id] && c[it.id][0]).length, live: true, cells: c };
    }
    const d = dayMap[date] || { total: 0, done: 0 };
    return { date, total: d.total, done: d.done, cells: c };
  });

  return {
    today,
    items: items.map(it => ({ id: it.id, name: it.name, order: it.order, start: it.start, end: it.end })),
    days,
    folderUrl: p.getProperty('FOLDER_URL'),
    lastWeeklyExport: p.getProperty('LAST_WEEKLY_EXPORT') || '',
  };
}

function cleanName_(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('項目名を入力してください。');
  if (s.length > MAX_NAME) throw new Error('項目名は' + MAX_NAME + '文字以内にしてください。');
  return s;
}

function findItem_(items, id) {
  const it = items.filter(x => x.id === id)[0];
  if (!it) throw new Error('項目が見つかりません。');
  return it;
}

// 当日の1項目分を保存する。日付が変わっていたら拒否する（確定済みの日は修正不可）
function saveEntry(date, itemId, done, comment) {
  const text = String(comment || '');
  if (text.length > MAX_COMMENT) throw new Error('コメントは' + MAX_COMMENT + '文字以内にしてください。');
  return withLock_(() => {
    const today = todayStr_();
    if (date !== today) throw new Error('DATE_CHANGED');
    const ss = openSs_();
    finalizePending_(ss);
    const it = findItem_(readItems_(ss), itemId);
    if (activeItemsOn_([it], today).length === 0) throw new Error('この項目は今日の入力対象ではありません。');
    const now = nowStr_();
    const obj = { date, itemId, itemName: it.name, done: !!done, comment: text, updatedAt: now };
    const rec = indexRecords_(readRecords_(ss))[recordKey_(date, itemId)];
    if (rec) updateRow_(ss, 'records', rec._row, obj);
    else appendRows_(ss, 'records', [obj]);
    return { savedAt: now };
  });
}

// 項目の追加：今日から入力対象になる
function addItem(name) {
  const n = cleanName_(name);
  return withLock_(() => {
    const ss = openSs_();
    const items = readItems_(ss);
    if (items.some(it => !it.end && it.name === n)) throw new Error('同じ名前の項目があります。');
    const order = items.reduce((m, it) => Math.max(m, it.order), 0) + 1;
    const id = 'i' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    appendRows_(ss, 'items', [{ id, name: n, order, start: todayStr_(), end: '' }]);
    return buildAppData_(ss);
  });
}

// 名称変更：表は新しい名称で表示する。CSVに残す「その日の名称」は今日の記録から反映する
function renameItem(id, name) {
  const n = cleanName_(name);
  return withLock_(() => {
    const ss = openSs_();
    const items = readItems_(ss);
    const it = findItem_(items, id);
    if (items.some(x => x.id !== id && !x.end && x.name === n)) throw new Error('同じ名前の項目があります。');
    it.name = n;
    updateRow_(ss, 'items', it._row, it);
    const today = todayStr_();
    readRecords_(ss)
      .filter(r => r.date === today && r.itemId === id)
      .forEach(r => { r.itemName = n; updateRow_(ss, 'records', r._row, r); });
    return buildAppData_(ss);
  });
}

// 並べ替え：終了していない項目の中で、上（-1）または下（+1）と入れ替える
function moveItem(id, dir) {
  return withLock_(() => {
    const ss = openSs_();
    const list = readItems_(ss).filter(it => !it.end).sort((a, b) => a.order - b.order);
    const i = list.findIndex(it => it.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return buildAppData_(ss);
    const a = list[i];
    const b = list[j];
    const t = a.order;
    a.order = b.order;
    b.order = t;
    updateRow_(ss, 'items', a._row, a);
    updateRow_(ss, 'items', b._row, b);
    return buildAppData_(ss);
  });
}

// 終了：今日までは入力対象のまま、明日から入力欄と達成率の分母から外れる。過去の記録は残る
// 今日追加したばかりの項目は、今日の入力対象からもすぐ外す
function endItem(id) {
  return withLock_(() => {
    const ss = openSs_();
    const items = readItems_(ss);
    const it = findItem_(items, id);
    if (it.end) return buildAppData_(ss);
    if (items.filter(x => !x.end).length <= 1) throw new Error('項目を1つ以上残してください。');
    const today = todayStr_();
    it.end = it.start === today ? addDays_(today, -1) : today;
    updateRow_(ss, 'items', it._row, it);
    return buildAppData_(ss);
  });
}


// ==== 2. 記録用スプレッドシートの読み書き ====
//   items   : 項目（id, 名称, 表示順, 開始日, 終了日）
//   records : 日×項目の記録（日付, 項目id, その日の項目名, 実施 1/0, コメント, 更新日時）
//   days    : 確定した日の集計（日付, 項目数, 実施数, 達成率, 確定日時）
// セルはすべて書式「書式なしテキスト」で書き、読むときに型を戻す

const SHEETS = {
  items: ['id', 'name', 'order', 'start', 'end'],
  records: ['date', 'itemId', 'itemName', 'done', 'comment', 'updatedAt'],
  days: ['date', 'total', 'done', 'rate', 'finalizedAt'],
};

function props_() {
  return PropertiesService.getScriptProperties();
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function openSs_() {
  const id = props_().getProperty('SS_ID');
  if (!id) throw new Error('初期設定がまだです。スクリプトエディタで setup を実行してください。');
  return SpreadsheetApp.openById(id);
}

// 同時に書き込まないよう、更新処理はすべてロックの中で行う
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// 文字列が = で始まると数式として解釈されるので、先頭にゼロ幅スペースを付けて保存する
function toCell_(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return s.charAt(0) === '=' ? '​' + s : s;
}

function fromCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v);
  return s.charAt(0) === '​' ? s.slice(1) : s;
}

function readTable_(ss, name) {
  const cols = SHEETS[name];
  const values = ss.getSheetByName(name).getDataRange().getValues();
  return values.slice(1)
    .map((r, i) => {
      const o = { _row: i + 2 };
      cols.forEach((c, j) => { o[c] = fromCell_(r[j] === undefined ? '' : r[j]); });
      return o;
    })
    .filter(o => o[cols[0]] !== '');
}

function readItems_(ss) {
  return readTable_(ss, 'items').map(o => ({
    _row: o._row, id: o.id, name: o.name, order: Number(o.order), start: o.start, end: o.end || '',
  }));
}

function readRecords_(ss) {
  return readTable_(ss, 'records').map(o => ({
    _row: o._row, date: o.date, itemId: o.itemId, itemName: o.itemName,
    done: o.done === '1' || o.done === 'true', comment: o.comment, updatedAt: o.updatedAt,
  }));
}

function readDays_(ss) {
  return readTable_(ss, 'days').map(o => ({
    date: o.date, total: Number(o.total), done: Number(o.done), rate: Number(o.rate),
  }));
}

function recordKey_(date, itemId) {
  return date + '|' + itemId;
}

function indexRecords_(records) {
  const idx = {};
  records.forEach(r => { idx[recordKey_(r.date, r.itemId)] = r; });
  return idx;
}

function rowValues_(name, obj) {
  return SHEETS[name].map(c => {
    const v = obj[c];
    if (typeof v === 'boolean') return v ? '1' : '0';
    return toCell_(v);
  });
}

function appendRows_(ss, name, objs) {
  if (!objs.length) return;
  const sh = ss.getSheetByName(name);
  const cols = SHEETS[name].length;
  sh.getRange(sh.getLastRow() + 1, 1, objs.length, cols)
    .setNumberFormat('@')
    .setValues(objs.map(o => rowValues_(name, o)));
}

function updateRow_(ss, name, row, obj) {
  const cols = SHEETS[name].length;
  ss.getSheetByName(name).getRange(row, 1, 1, cols)
    .setNumberFormat('@')
    .setValues([rowValues_(name, obj)]);
}

// 前日までの未確定の日を確定する（実施なしの項目も 0 として行を作る）
// 毎日の自動処理と、アプリを開いたときの両方から呼ぶ（自動処理が失敗した日も埋まるように）
function finalizePending_(ss) {
  const p = props_();
  const yesterday = addDays_(todayStr_(), -1);
  const last = p.getProperty('LAST_FINALIZED');
  if (last >= yesterday) return;

  const items = readItems_(ss);
  const idx = indexRecords_(readRecords_(ss));
  const now = nowStr_();
  const newRecords = [];
  const newDays = [];
  dateRange_(addDays_(last, 1), yesterday).forEach(date => {
    const active = activeItemsOn_(items, date);
    let done = 0;
    active.forEach(it => {
      const rec = idx[recordKey_(date, it.id)];
      if (rec) {
        if (rec.done) done++;
      } else {
        newRecords.push({ date, itemId: it.id, itemName: it.name, done: false, comment: '', updatedAt: now });
      }
    });
    const total = active.length;
    newDays.push({ date, total, done, rate: total ? Math.round(done / total * 1000) / 1000 : 0, finalizedAt: now });
  });
  appendRows_(ss, 'records', newRecords);
  appendRows_(ss, 'days', newDays);
  p.setProperty('LAST_FINALIZED', yesterday);
}


// ==== 3. Google Drive の「習慣化ログ」フォルダへの CSV 出力 ====

// from〜to の各日・各項目の行（項目名はその日の名称）
function collectCsvRows_(ss, from, to) {
  const items = readItems_(ss);
  const idx = indexRecords_(readRecords_(ss));
  const rows = [];
  dateRange_(from, to).forEach(date => {
    activeItemsOn_(items, date).forEach(it => {
      const rec = idx[recordKey_(date, it.id)];
      rows.push({
        date,
        name: rec ? rec.itemName : it.name,
        done: rec ? rec.done : false,
        comment: rec ? rec.comment : '',
      });
    });
  });
  return rows;
}

// 同名のファイルがあればゴミ箱に移してから作る（＝上書き）
function writeCsv_(fileName, csv, overwrite) {
  const folder = DriveApp.getFolderById(props_().getProperty('FOLDER_ID'));
  if (overwrite) {
    const old = folder.getFilesByName(fileName);
    while (old.hasNext()) old.next().setTrashed(true);
  }
  const file = folder.createFile(Utilities.newBlob(csv, 'text/csv', fileName));
  return { name: fileName, url: file.getUrl() };
}

// 確定済みの月〜日の週のうち、まだ出力していない週を出力する
function exportPendingWeeks_(ss) {
  const p = props_();
  const start = p.getProperty('START_DATE');
  const finalized = p.getProperty('LAST_FINALIZED');
  const out = [];
  let weekEnd = addDays_(p.getProperty('LAST_EXPORTED_WEEK_END'), 7);
  while (weekEnd <= finalized) {
    const monday = addDays_(weekEnd, -6);
    // 使い始めた週は、使い始めた日から
    const from = monday < start ? start : monday;
    const csv = buildCsv_(collectCsvRows_(ss, from, weekEnd));
    out.push(writeCsv_('習慣化ログ_' + monday + '_' + weekEnd + '.csv', csv, true));
    p.setProperty('LAST_EXPORTED_WEEK_END', weekEnd);
    p.setProperty('LAST_WEEKLY_EXPORT', nowStr_());
    weekEnd = addDays_(weekEnd, 7);
  }
  return out;
}

// 任意のタイミングでの出力（当日分は入力中の内容で含める）
function exportRange(from, to) {
  if (!isYmd_(from) || !isYmd_(to)) throw new Error('日付の形式が正しくありません。');
  if (from > to) throw new Error('開始日は終了日以前にしてください。');
  const start = props_().getProperty('START_DATE');
  const today = todayStr_();
  const f = from < start ? start : from;
  const t = to > today ? today : to;
  if (f > t) throw new Error('指定した期間に記録がありません（記録開始日：' + start + '）。');
  return withLock_(() => {
    const ss = openSs_();
    finalizePending_(ss);
    const rows = collectCsvRows_(ss, f, t);
    const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd-HHmm');
    const res = writeCsv_('習慣化ログ_手動_' + f + '_' + t + '_出力' + stamp + '.csv', buildCsv_(rows), false);
    res.rows = rows.length;
    return res;
  });
}


// ==== 4. 日付・CSVなど、Googleのサービスに依存しない処理 ====
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
