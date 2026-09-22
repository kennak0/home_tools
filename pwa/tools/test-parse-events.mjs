// parse-events.js の手元テスト。node pwa/tools/test-parse-events.mjs
import { parseEvents } from "../family-schedule/parse-events.js";
import assert from "node:assert/strict";

const today = new Date(2026, 8, 22); // 2026-09-22
const run = (text) => parseEvents(text, { today });

let r = run(`10月の予定（さくら小学校 2年1組）
10/3（土） 遠足 お弁当・水筒。9:00 集合
10/10（土） 授業参観 13:30〜14:15
１０／１８（日）運動会 雨天は 10/19 に順延
24日（土）歯科検診
持ち物は上履き`);
assert.equal(r.events.length, 4);
assert.deepEqual(r.events.map((e) => [e.title, e.date, e.start, e.end, e.confidence]), [
  ["遠足", "2026-10-03", "09:00", null, "high"],
  ["授業参観", "2026-10-10", "13:30", "14:15", "high"],
  ["運動会", "2026-10-18", null, null, "high"],
  ["歯科検診", "2026-10-24", null, null, "high"],
]);
assert.equal(r.events[0].note, "お弁当・水筒。集合");
assert.deepEqual(r.unparsed, ["持ち物は上履き"]);

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
r = run("2/30 テスト");
assert.deepEqual([r.events[0].date, r.events[0].confidence], ["", "low"]);

// 全角・時刻の後ろに文字
r = run("１１月３日（火）文化祭　９時３０分開場　体育館");
assert.deepEqual([r.events[0].title, r.events[0].date, r.events[0].start, r.events[0].note], ["文化祭", "2026-11-03", "09:30", "開場 体育館"]);

// OCR（Tesseract, PSM 4）の出力そのまま。日付と曜日の間の空白、罫線の |
r = run(`10月の予定 (さくら小学校 2年1組)

日 予定 備考

10/3 (土) |遠足 お弁当・水筒。9:00 集合

10/10 (土) |授業参観 | 13:30~14:15

10/18 (日) |運動会 | 雨天は10/19 に順延

10/24 (土) |歯科検診

持ち物は上履きです。`);
assert.deepEqual(r.events.map((e) => [e.title, e.date, e.start, e.end, e.note, e.confidence]), [
  ["遠足", "2026-10-03", "09:00", null, "お弁当・水筒。集合", "high"],
  ["授業参観", "2026-10-10", "13:30", "14:15", "", "high"],
  ["運動会", "2026-10-18", null, null, "雨天は10/19 に順延", "high"],
  ["歯科検診", "2026-10-24", null, null, "", "high"],
]);
assert.deepEqual(r.unparsed, ["日 予定 備考", "持ち物は上履きです。"]);

console.log("all passed");
