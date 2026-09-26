// 解答履歴（localStorage）の読み書き、書き出し・読み込み
const KEY = 'kakomon-app:v1';
const VERSION = 1;

export function emptyHistory() {
  return { version: VERSION, stats: {}, review: [] };
}

// データの形が正しいかを検査する（読み込み時に壊れたデータで上書きしないため）
export function isValidHistory(h) {
  if (!h || typeof h !== 'object' || h.version !== VERSION) return false;
  if (!h.stats || typeof h.stats !== 'object' || Array.isArray(h.stats)) return false;
  if (!Array.isArray(h.review) || !h.review.every(id => typeof id === 'string')) return false;
  return Object.values(h.stats).every(s =>
    s && Number.isInteger(s.tries) && Number.isInteger(s.correct) &&
    s.correct >= 0 && s.correct <= s.tries &&
    (s.last === 'correct' || s.last === 'wrong') && typeof s.lastAt === 'string');
}

export function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(KEY));
    if (isValidHistory(h)) return h;
  } catch {
    // 読めないときは空の履歴で始める
  }
  return emptyHistory();
}

export function saveHistory(h) {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    // プライベートモードなどで保存できない場合も、画面の動作は続ける
  }
}

// 1問の解答を記録する。
// 不正解ならモードを問わず復習リストに入れ、復習モードで正解したときだけ外す。
export function recordAnswer(h, id, isCorrect, mode) {
  const s = h.stats[id] ?? { tries: 0, correct: 0, last: 'wrong', lastAt: '' };
  s.tries += 1;
  if (isCorrect) s.correct += 1;
  s.last = isCorrect ? 'correct' : 'wrong';
  s.lastAt = localIsoString(new Date());
  h.stats[id] = s;

  if (!isCorrect && !h.review.includes(id)) h.review.push(id);
  if (isCorrect && mode === 'review') h.review = h.review.filter(r => r !== id);
  saveHistory(h);
}

export function exportHistory(h) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const blob = new Blob([JSON.stringify(h, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kakomon-backup-${ymd}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ファイルの中身を解析する。形が正しくなければ例外を投げる。
export function parseHistory(text) {
  let h;
  try {
    h = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読めないファイルです。');
  }
  if (!isValidHistory(h)) throw new Error('このアプリの履歴ファイルではないか、形式が正しくありません。');
  return h;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// 例: 2026-09-26T08:12:00+09:00
function localIsoString(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
