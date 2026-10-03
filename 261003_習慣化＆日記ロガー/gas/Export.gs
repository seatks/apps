// Google Drive の「習慣化ログ」フォルダへの CSV 出力

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
