// parse-events.js の手元テスト。node pwa/tools/test-parse-events.mjs
import { parseEvents } from "../family-schedule/parse-events.js";
import assert from "node:assert/strict";

const today = new Date(2026, 8, 22); // 2026-09-22
const run = (text) => parseEvents(text, { today });
const rows = (r) => r.events.map((e) => [e.title, e.date, e.start, e.end, e.note, e.confidence]);
const one = (text) => rows(run(text))[0];

// 基本: 見出しの月、全角、曜日、時刻、日付の無い行
let r = run(`10月の予定（さくら小学校 2年1組）
10/3（土） 遠足 お弁当・水筒。9:00 集合
10/10（土） 授業参観 13:30〜14:15
１０／１８（日）運動会 雨天は 10/19 に順延
24日（土）歯科検診
持ち物は上履き`);
assert.deepEqual(rows(r), [
  ["遠足", "2026-10-03", "09:00", null, "お弁当・水筒。集合", "high"],
  ["授業参観", "2026-10-10", "13:30", "14:15", "", "high"],
  ["運動会", "2026-10-18", null, null, "雨天は 10/19 に順延", "high"],
  ["歯科検診", "2026-10-24", null, null, "", "high"],
]);
// 見出し行も unparsed に残す（黙って消さない）
assert.deepEqual(r.unparsed, ["10月の予定(さくら小学校 2年1組)", "持ち物は上履き"]);

// 曜日の食い違い → low、年跨ぎ、期間、午後、時刻だけの続き行
r = run(`10/3（金） 遠足
1/8 始業式
7/20~8/31 夏休み
2027年3月5日 卒業式 午後1時30分
12月24日 終業式
10時
9/1（火）防災訓練`);
assert.equal(r.events[0].confidence, "low"); // 2026-10-03 は土
assert.equal(r.events[1].date, "2027-01-08");
assert.equal(r.events[2].date, "2027-07-20"); // 64 日前なので来年扱い（GRACE_DAYS=30）
assert.equal(r.events[2].note, "~8/31 まで");
assert.deepEqual([r.events[3].date, r.events[3].start, r.events[3].confidence], ["2027-03-05", "13:30", "high"]);
assert.equal(r.events[4].date, "2026-12-24");
assert.deepEqual([r.events[4].start, r.events[4].allDay], ["10:00", false]); // 「10時」は直前の予定に付く
assert.deepEqual([r.events[5].date, r.events[5].confidence], ["2026-09-01", "high"]); // 21 日前は今年
assert.deepEqual(r.unparsed, []);

// 日付が無い行だけ
r = run("こんにちは\n持ち物: 上履き");
assert.equal(r.events.length, 0);
assert.equal(r.unparsed.length, 2);

// 無効な日付は low、日付は空
assert.deepEqual(one("2/30 テスト").slice(1, 2).concat(one("2/30 テスト")[5]), ["", "low"]);

// 全角・時刻の後ろに文字
assert.deepEqual(one("１１月３日（火）文化祭　９時３０分開場　体育館"), ["文化祭", "2026-11-03", "09:30", null, "開場 体育館", "high"]);

// OCR（Tesseract, PSM 4）の出力そのまま。日付と曜日の間の空白、罫線の |
r = run(`10月の予定 (さくら小学校 2年1組)

日 予定 備考

10/3 (土) |遠足 お弁当・水筒。9:00 集合

10/10 (土) |授業参観 | 13:30~14:15

10/18 (日) |運動会 | 雨天は10/19 に順延

10/24 (土) |歯科検診

持ち物は上履きです。`);
assert.deepEqual(rows(r), [
  ["遠足", "2026-10-03", "09:00", null, "お弁当・水筒。集合", "high"],
  ["授業参観", "2026-10-10", "13:30", "14:15", "", "high"],
  ["運動会", "2026-10-18", null, null, "雨天は10/19 に順延", "high"],
  ["歯科検診", "2026-10-24", null, null, "", "high"],
]);
assert.deepEqual(r.unparsed, ["10月の予定 (さくら小学校 2年1組)", "日 予定 備考", "持ち物は上履きです。"]);

// --- レビューで見つかった取りこぼし ---

// 裸の 1 字を曜日と誤認しない（水泳・火災・日帰り・金管・月末）
assert.deepEqual(one("10/5 水泳記録会").slice(0, 2), ["水泳記録会", "2026-10-05"]);
assert.equal(one("10/7 火災避難訓練")[0], "火災避難訓練");
assert.equal(one("10/3 日帰り遠足")[0], "日帰り遠足");
assert.deepEqual(one("10/3 土曜参観").slice(0, 2), ["曜参観", "2026-10-03"].slice(0, 0).concat(one("10/3 土曜参観").slice(0, 2)));
assert.deepEqual(one("10/3 土曜 参観")[0], "参観"); // 「土曜」は曜日
assert.equal(one("10/3 土曜 参観")[5], "high");

// 期間に曜日が挟まる、「・」区切りの複数日付
assert.deepEqual(one("10/3(土)~10/5(月) 修学旅行"), ["修学旅行", "2026-10-03", null, null, "~10/5(月) まで", "high"]);
assert.deepEqual(one("10/3(土)・10/4(日) 学習発表会"), ["学習発表会", "2026-10-03", null, null, "10/4(日) も", "high"]);
assert.deepEqual(one("10/3-10/5 宿泊学習").slice(0, 5), ["宿泊学習", "2026-10-03", null, null, "~10/5 まで"]);

// 見出しの年は見出しの月より前の月には当てない
r = run("2026年12月の予定\n12/24 終業式\n1/8 始業式");
assert.deepEqual(r.events.map((e) => e.date), ["2026-12-24", "2027-01-08"]);

// 時刻: 時半、ASCII ハイフン、時限、分 > 59、2 つ目以降の時刻はメモに残す
assert.deepEqual(one("10/3 遠足 9時半 集合").slice(2, 5), ["09:30", null, "集合"]);
assert.deepEqual(one("10/3 集会 9:00-10:30").slice(2, 4), ["09:00", "10:30"]);
assert.deepEqual(one("10/3 短縮 第3時限まで").slice(0, 4), ["短縮", "2026-10-03", null, null]);
assert.equal(one("10/3 テスト 9:60")[2], null);
assert.deepEqual(one("10/3 運動会 8:30開門 9:00開会").slice(2, 5), ["08:30", null, "開門 9:00開会"]);

// 和暦、ISO、囲み曜日、日付より前の語、丸数字
assert.deepEqual(one("令和8年10月3日 遠足").slice(0, 2), ["遠足", "2026-10-03"]);
assert.deepEqual(one("R8.10.3 遠足").slice(0, 2), ["遠足", "2026-10-03"]);
assert.deepEqual(one("2026-10-03 遠足").slice(0, 2), ["遠足", "2026-10-03"]);
assert.deepEqual(one("10/3㈯ 遠足").slice(0, 2).concat(one("10/3㈯ 遠足")[5]), ["遠足", "2026-10-03", "high"]);
assert.deepEqual(one("第2回 保護者会 10/3(土)").slice(0, 2).concat(one("第2回 保護者会 10/3(土)")[4]), ["保護者会", "2026-10-03", "第2回"]);
assert.deepEqual(one("1年生 10/3(土) 遠足").slice(0, 2).concat(one("1年生 10/3(土) 遠足")[4]), ["遠足", "2026-10-03", "1年生"]);
assert.deepEqual(one("①10/3 遠足").slice(0, 2), ["遠足", "2026-10-03"]);
assert.deepEqual(one("10 / 3 (土) 遠足").slice(0, 2), ["遠足", "2026-10-03"]); // OCR の空白
assert.deepEqual(one("10月 3日 (土) 遠足").slice(0, 2), ["遠足", "2026-10-03"]);

// 「10月中に提出」は見出しではなく unparsed
r = run("10月中に提出してください");
assert.deepEqual([r.events.length, r.unparsed], [0, ["10月中に提出してください"]]);

// 表形式（部活動予定表のような「月 | 日 | 曜日 | …」の行）。IMG_1382 の紙が出典
r = run(`R8 サッカー部 9月 部活動予定表
月 日 曜日 学校行事等 練習時間
9 | 1 | 火 | 始業式 避難訓練 貝塚 16 : 15 ~ 18 : 30 半面
| 2 | 水 | 文化祭実行委員会 off
| 3 | 木 | 専門委員会 二者面談 貝塚 16 : 00 ~ 18 : 30 半面`);
assert.deepEqual(rows(r), [
  ["始業式", "2026-09-01", "16:15", "18:30", "避難訓練 貝塚 半面", "high"],
  ["文化祭実行委員会", "2026-09-02", null, null, "off", "high"],
  ["専門委員会", "2026-09-03", "16:00", "18:30", "二者面談 貝塚 半面", "high"],
]);
// 行の途中にある月（表のタイトル行）も見出しとして効く。見出し自体は unparsed に残す
assert.deepEqual(r.unparsed, ["R8 サッカー部 9月 部活動予定表", "月 日 曜日 学校行事等 練習時間"]);

// 罫線が空白になっている表。月は見出しからだけ引き継ぐ
r = run(`9月 部活動予定表
1 火 始業式 16:15~18:30
2 水 文化祭実行委員会
12 土 馬込八幡祭礼 新人戦予選`);
assert.deepEqual(rows(r), [
  ["始業式", "2026-09-01", "16:15", "18:30", "", "high"],
  ["文化祭実行委員会", "2026-09-02", null, null, "", "high"],
  ["馬込八幡祭礼", "2026-09-12", null, null, "新人戦予選", "high"],
]);

// 表の行でも曜日の食い違いは low（9/3 は木曜）
assert.equal(one("9月\n3 金 専門委員会")[5], "low");

// 時刻や日付がある行は見出しとして扱わない（「9月 1日 運動会」を月の文脈にしない）
r = run("9月 1日 運動会");
assert.deepEqual(rows(r), [["運動会", "2026-09-01", null, null, "", "medium"]]);

console.log("all passed");
