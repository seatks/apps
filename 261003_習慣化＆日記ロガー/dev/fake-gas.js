// GAS のサービス（SpreadsheetApp, DriveApp など）の簡易な偽物。
// gas/Code.gs を Node で動かして確認するためだけに使う（GAS には貼り付けない）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function createGas() {
  let now = Date.now();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }

  let seq = 0;
  const newId = p => p + (++seq);

  // ---- Spreadsheet ----
  class Range {
    constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
    setNumberFormat() { return this; }
    setValues(v) {
      if (v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error('setValues: size mismatch');
      v.forEach((r, i) => r.forEach((val, j) => {
        if (typeof val === 'string' && val.charAt(0) === '=') throw new Error('数式として解釈される値: ' + val);
        const rr = this.row - 1 + i;
        while (this.sheet.rows.length <= rr) this.sheet.rows.push([]);
        this.sheet.rows[rr][this.col - 1 + j] = val;
      }));
      return this;
    }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    setName(n) { this.name = n; return this; }
    getName() { return this.name; }
    getLastRow() { return this.rows.length; }
    getMaxRows() { return Math.max(1000, this.rows.length); }
    setFrozenRows() {}
    getRange(row, col, nr = 1, nc = 1) { return new Range(this, row, col, nr, nc); }
    getDataRange() {
      const rows = this.rows;
      const w = Math.max(1, ...rows.map(r => r.length));
      return { getValues: () => rows.length ? rows.map(r => Array.from({ length: w }, (_, j) => r[j] === undefined ? '' : r[j])) : [['']] };
    }
  }
  class Spreadsheet {
    constructor(name) { this.id = newId('ss'); this.name = name; this.sheets = [new Sheet('シート1')]; }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheets() { return this.sheets; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  }
  const spreadsheets = {};

  // ---- Drive ----
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  class File {
    constructor(name, content, folder) { Object.assign(this, { id: newId('f'), name, content, folder, trashed: false }); }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id; }
    setTrashed(t) { this.trashed = t; }
    moveTo(folder) { this.folder = folder; }
  }
  class Folder {
    constructor(name) { Object.assign(this, { id: newId('fo'), name, files: [] }); }
    getId() { return this.id; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    getFilesByName(n) { return iter(this.files.filter(f => f.name === n && !f.trashed)); }
    createFile(blob) { const f = new File(blob.name, blob.data, this); this.files.push(f); return f; }
  }
  const folders = [];
  const root = { getFoldersByName: n => iter(folders.filter(f => f.name === n)) };

  const props = {};
  const triggers = [];

  const ctx = {
    Date: FakeDate,
    console,
    Logger: { log: () => {} },
    Utilities: {
      formatDate(d, tz, fmt) {
        const p = {};
        new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
          .formatToParts(d).forEach(x => { p[x.type] = x.value; });
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
          .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
      getUuid: () => crypto.randomUUID(),
      newBlob: (data, type, name) => ({ data, type, name }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      create(name) { const s = new Spreadsheet(name); spreadsheets[s.id] = s; return s; },
      openById(id) { return spreadsheets[id]; },
    },
    DriveApp: {
      getRootFolder: () => root,
      createFolder(n) { const f = new Folder(n); folders.push(f); return f; },
      getFolderById: id => folders.find(f => f.id === id),
      getFileById: id => ({ moveTo: () => {} }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(fn) {
        const t = { fn, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, everyDays: () => b, atHour: h => { t.hour = h; return b; }, nearMinute: () => b, inTimezone: () => b, create: () => { triggers.push(t); return t; } };
        return b;
      },
    },
    HtmlService: {},
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'gas');
  vm.runInContext(fs.readFileSync(path.join(dir, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

  // 画面からの呼び出し（google.script.run）と同じく、戻り値をJSONで受け渡す
  const api = new Proxy(ctx, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      return (...a) => { const r = v(...a); return r === undefined ? r : JSON.parse(JSON.stringify(r)); };
    },
  });

  return {
    ctx: api,
    props,
    folders,
    triggers,
    spreadsheets,
    // 日本時間で時計を合わせる（例 '2026-10-01 10:00'）
    setNow(jst) { now = new RealDate(jst.replace(' ', 'T') + ':00+09:00').getTime(); },
  };
}

module.exports = { createGas };
