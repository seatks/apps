// 画面の切り替えと出題の流れ
import {
  loadHistory, saveHistory, recordAnswer, exportHistory, parseHistory,
} from './storage.js';

const SET_SIZE = 10;
const KANA = ['ア', 'イ', 'ウ', 'エ'];

const $ = id => document.getElementById(id);

let exams = [];           // data/index.json の内容
let questions = [];       // 全回の問題
let byId = new Map();
let history = loadHistory();

// 実行中のセット
let session = null;       // { mode, items: [{ q, chosen, correct }], pos }

// ---------- 起動 ----------

async function init() {
  try {
    exams = await fetchJson('data/index.json');
    const lists = await Promise.all(exams.map(e => fetchJson(e.file)));
    questions = lists.flat();
    byId = new Map(questions.map(q => [q.id, q]));
  } catch (e) {
    $('loading').textContent = `問題データを読み込めませんでした（${e.message}）。`;
    return;
  }
  $('loading').hidden = true;
  bindEvents();
  showHome();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function bindEvents() {
  $('startRandom').addEventListener('click', () => startSession('random'));
  $('startReview').addEventListener('click', () => startSession('review'));
  $('toReviewBtn').addEventListener('click', () => startSession('review'));
  $('againBtn').addEventListener('click', () => startSession(session.mode));
  $('homeBtn').addEventListener('click', showHome);
  $('nextBtn').addEventListener('click', next);
  $('quitBtn').addEventListener('click', quit);
  $('exportBtn').addEventListener('click', () => exportHistory(history));
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', importFile);
  $('zoom').addEventListener('click', () => { $('zoom').hidden = true; });
}

// 問題文を表示用のノードにする。
// 結合上線（U+0305）・結合下線（U+0332）はフォントによって位置がずれるため、
// 直前の文字を CSS の上線・下線付きの span で描く。HTML としては解釈しない。
const MARKS = { '\u0305': 'ov', '\u0332': 'ul' };

function richText(text) {
  const frag = document.createDocumentFragment();
  let plain = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const cls = MARKS[chars[i + 1]];
    if (!cls) {
      plain += chars[i];
      continue;
    }
    frag.append(plain);
    plain = '';
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = chars[i];
    frag.append(span);
    i += 1;
  }
  frag.append(plain);
  return frag;
}

function stripMarks(text) {
  return text.replace(/[\u0305\u0332]/g, '');
}

function show(screenId) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== screenId;
  window.scrollTo(0, 0);
}

// ---------- ホーム ----------

// 収録から外れた問題の履歴は数えない
function reviewIds() {
  return history.review.filter(id => byId.has(id));
}

function showHome() {
  const stats = Object.entries(history.stats).filter(([id]) => byId.has(id)).map(([, s]) => s);
  const tries = stats.reduce((n, s) => n + s.tries, 0);
  const correct = stats.reduce((n, s) => n + s.correct, 0);
  const reviewCount = reviewIds().length;

  $('reviewCount').textContent = reviewCount;
  $('startReview').disabled = reviewCount === 0;
  $('answeredCount').textContent = stats.length;
  $('totalCount').textContent = questions.length;
  $('accuracy').textContent = tries ? `${Math.round((correct / tries) * 100)}%` : '—';
  $('exams').textContent = exams.map(e => e.short).join(' ');
  show('home');
}

// ---------- 出題 ----------

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSession(mode) {
  const pool = mode === 'review' ? reviewIds().map(id => byId.get(id)) : questions;
  if (pool.length === 0) {
    showHome();
    return;
  }
  const picked = shuffle(pool).slice(0, SET_SIZE);
  session = { mode, items: picked.map(q => ({ q, chosen: null, correct: false })), pos: 0 };
  renderQuestion();
  show('quiz');
}

function examShort(q) {
  const id = q.id.split('-')[0];
  return exams.find(e => e.id === id)?.short ?? q.exam;
}

function renderQuestion() {
  const { q } = session.items[session.pos];
  const modeLabel = session.mode === 'review' ? '復習 ' : '';
  $('progress').textContent = `${modeLabel}問 ${session.pos + 1}/${session.items.length}`;
  $('origin').textContent = `${examShort(q)} 問${q.number}`;
  $('questionText').replaceChildren(richText(q.question));

  $('figures').replaceChildren(...q.figures.map(src => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = `問${q.number}の図`;
    img.addEventListener('click', () => {
      $('zoomImg').src = src;
      $('zoom').hidden = false;
    });
    return img;
  }));

  $('choices').replaceChildren(...KANA.map(k => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.dataset.kana = k;
    const label = document.createElement('span');
    label.className = 'kana';
    label.textContent = k;
    btn.append(label);
    if (q.choices) {
      const text = document.createElement('span');
      text.append(richText(q.choices[k]));
      btn.append(text);
    } else {
      btn.classList.add('kana-only');
    }
    btn.addEventListener('click', () => answer(k));
    return btn;
  }));

  $('feedback').hidden = true;
  $('nextBtn').hidden = true;
}

function answer(kana) {
  const item = session.items[session.pos];
  if (item.chosen) return;   // 選び直しはできない
  item.chosen = kana;
  item.correct = kana === item.q.answer;
  recordAnswer(history, item.q.id, item.correct, session.mode);

  for (const btn of $('choices').children) {
    btn.disabled = true;
    if (btn.dataset.kana === item.q.answer) btn.classList.add('is-answer');
    else if (btn.dataset.kana === kana) btn.classList.add('is-wrong');
  }
  const fb = $('feedback');
  fb.textContent = item.correct ? '○ 正解' : `× 不正解（正解は ${item.q.answer}）`;
  fb.className = `feedback ${item.correct ? 'ok' : 'ng'}`;
  fb.hidden = false;

  const last = session.pos === session.items.length - 1;
  $('nextBtn').textContent = last ? '結果を見る' : '次へ';
  $('nextBtn').hidden = false;
  $('nextBtn').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function next() {
  if (session.pos < session.items.length - 1) {
    session.pos += 1;
    renderQuestion();
    window.scrollTo(0, 0);
  } else {
    showResult();
  }
}

// 解いた問題までの結果は保存済み。セットは破棄する。
function quit() {
  if (confirm('このセットを中断してホームに戻りますか？\n（解答済みの問題の結果は保存されています）')) {
    showHome();
  }
}

// ---------- 結果 ----------

function showResult() {
  const items = session.items;
  const correct = items.filter(i => i.correct).length;
  $('score').textContent = `${correct} / ${items.length} 正解`;
  $('resultList').replaceChildren(...items.map(resultItem));

  const reviewCount = reviewIds().length;
  $('toReviewBtn').disabled = reviewCount === 0;
  $('againBtn').disabled = session.mode === 'review' && reviewCount === 0;
  show('result');
}

function resultItem({ q, chosen, correct }) {
  const details = document.createElement('details');
  details.className = `result-item ${correct ? 'ok' : 'ng'}`;

  const summary = document.createElement('summary');
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = correct ? '○' : '×';
  const head = document.createElement('span');
  head.className = 'head';
  const plain = stripMarks(q.question).replace(/\s+/g, ' ');
  head.textContent = `${examShort(q)} 問${q.number}　${plain.length > 40 ? `${plain.slice(0, 40)}…` : plain}`;
  summary.append(mark, head);

  const body = document.createElement('div');
  body.className = 'result-body';
  const answerLine = document.createElement('p');
  answerLine.className = 'answer-line';
  answerLine.append(`あなたの解答：${chosen}　正解：${q.answer}`);
  if (q.choices) answerLine.append('（', richText(q.choices[q.answer]), '）');
  body.append(answerLine);

  const exp = document.createElement('p');
  exp.className = 'explanation';
  exp.textContent = q.explanation || '解説準備中';
  body.append(exp);

  if (q.references?.length) {
    const ul = document.createElement('ul');
    ul.className = 'refs';
    for (const r of q.references) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = r.url;
      a.textContent = r.title || r.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(a);
      ul.append(li);
    }
    body.append(ul);
  }

  details.append(summary, body);
  return details;
}

// ---------- 読み込み ----------

async function importFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let incoming;
  try {
    incoming = parseHistory(await file.text());
  } catch (err) {
    alert(`読み込めませんでした。\n${err.message}`);
    return;
  }
  const count = h => `解答 ${Object.keys(h.stats).length}問・復習 ${h.review.length}問`;
  const ok = confirm(
    `現在の履歴（${count(history)}）を、ファイルの履歴（${count(incoming)}）で上書きします。よろしいですか？`);
  if (!ok) return;
  history = incoming;
  saveHistory(history);
  showHome();
}

init();
