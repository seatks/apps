// 記録用スプレッドシートの読み書き
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
