// 習慣化＆日記ロガー：Webアプリの入口、画面から呼ぶ処理、初期設定と毎日の自動処理

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
