// 段階 2: テキスト → 予定候補のルールベース解析。2a（貼り付け）も 2b（OCR）もここを通す。
// 依存なし・副作用なし。Node でも動くので pwa/tools/test-parse-events.mjs から直接テストできる。
//
// 1 行 = 1 予定を基本にする。行に日付が無く時刻だけあれば直前の予定に足す。
// 日付も時刻も無い行は unparsed に残し、UI で「読めなかった行」として見せる。

const WEEKDAYS = "日月火水木金土";
const GRACE_DAYS = 30; // 年が無い日付は「今日以降で最も近い」。ただし 30 日前までは今年扱い

// 全角 → 半角、揺れのある記号を寄せる
export function normalize(text) {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／]/g, "/")
    .replace(/[：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[〜～~‐‑–—―ｰ]/g, "~")
    .replace(/[　\t]+/g, " ")
    .replace(/\r/g, "");
}

const RE_DATE_FULL = /(\d{4})[/年.](\d{1,2})[/月.](\d{1,2})日?/g;
const RE_DATE_MD = /(?<![\d/:])(\d{1,2})[/月](\d{1,2})日?(?![\d/:])/g;
const RE_DATE_D = /(?<![\d/:月])(\d{1,2})日(?!間|後|前|以|目)/g;
const RE_WEEKDAY = /\s*\(?\s*([月火水木金土日])\s*(?:曜日?)?\s*\)?/y;
const RE_MONTH_HEADER = /^(?:(\d{4})年)?\s*(\d{1,2})月(?!\d|\s*\d)/;
const RE_TIME = /(午前|午後)?(\d{1,2})(?::(\d{2})|時(\d{1,2})?分?)(?!間|日|月|年)/g;
const RE_TIME_RANGE = /(午前|午後)?(\d{1,2})(?::(\d{2})|時(\d{1,2})?分?)\s*~\s*(午前|午後)?(\d{1,2})(?::(\d{2})|時(\d{1,2})?分?)/g;

const pad = (n) => String(n).padStart(2, "0");

function toTime(ampm, h, m) {
  let hour = Number(h);
  if (ampm === "午後" && hour < 12) hour += 12;
  if (ampm === "午前" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${pad(hour)}:${pad(Number(m ?? 0))}`;
}

function isValidDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// 年の無い月日に年を当てる。今日から GRACE_DAYS 以上前なら来年
function resolveYear(month, day, today) {
  const y = today.getFullYear();
  const candidate = new Date(y, month - 1, day);
  const grace = new Date(today);
  grace.setDate(grace.getDate() - GRACE_DAYS);
  return candidate < grace ? y + 1 : y;
}

function weekdayOf(y, m, d) {
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

// 行内の日付をすべて位置付きで拾う。context.month は「N日」だけの行に使う
function findDates(line, context) {
  const found = [];
  for (const m of line.matchAll(RE_DATE_FULL)) {
    found.push({ index: m.index, length: m[0].length, y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hasYear: true });
  }
  const covered = (i) => found.some((f) => i >= f.index && i < f.index + f.length);
  for (const m of line.matchAll(RE_DATE_MD)) {
    if (covered(m.index)) continue;
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    found.push({ index: m.index, length: m[0].length, y: context.year, m: mo, d, hasYear: false });
  }
  if (context.month) {
    for (const m of line.matchAll(RE_DATE_D)) {
      if (covered(m.index)) continue;
      const d = Number(m[1]);
      if (d < 1 || d > 31) continue;
      found.push({ index: m.index, length: m[0].length, y: context.year, m: context.month, d, hasYear: false });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function findTimes(line) {
  const ranges = [];
  for (const m of line.matchAll(RE_TIME_RANGE)) {
    const start = toTime(m[1], m[2], m[3] ?? m[4]);
    const end = toTime(m[5] ?? m[1], m[6], m[7] ?? m[8]);
    if (start && end) ranges.push({ index: m.index, length: m[0].length, start, end });
  }
  const covered = (i) => ranges.some((r) => i >= r.index && i < r.index + r.length);
  const singles = [];
  for (const m of line.matchAll(RE_TIME)) {
    if (covered(m.index)) continue;
    const t = toTime(m[1], m[2], m[3] ?? m[4]);
    if (t) singles.push({ index: m.index, length: m[0].length, start: t, end: null });
  }
  return [...ranges, ...singles].sort((a, b) => a.index - b.index);
}

function cut(line, spans) {
  let out = "";
  let pos = 0;
  for (const s of [...spans].sort((a, b) => a.index - b.index)) {
    out += line.slice(pos, s.index) + " ";
    pos = s.index + s.length;
  }
  return out + line.slice(pos);
}

// 切り取った跡の空白を詰める。句読点の前後には空白を残さない
function tidy(s) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*[|｜]\s*/g, " ") // OCR が表の罫線を | にする
    .replace(/\s+(?=[。、,.])/g, "")
    .replace(/(?<=[。、])\s+/g, "")
    .trim();
}

// 残った文字列を タイトル / メモ に分ける。最初の空白か句読点まではタイトル
function splitTitle(rest) {
  const cleaned = rest
    .replace(/^[\s|｜・:、,。.~()\-]+/, "")
    .replace(/[\s|｜・:、,~(\-]+$/, "")
    .replace(/\(\s*\)/g, "")
    .trim();
  if (!cleaned) return { title: "", note: "" };
  const m = cleaned.match(/^(.+?)(?:\s+|(?<=[。])|\s*[|｜]\s*)(.*)$/s);
  if (!m) return { title: cleaned, note: "" };
  return { title: m[1].trim(), note: tidy(m[2]) };
}

export function parseEvents(text, { today = new Date() } = {}) {
  const context = { year: null, month: null };
  const events = [];
  const unparsed = [];

  for (const raw of normalize(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // 「10月の予定」「2026年10月」のような見出し → 月の文脈にする
    const header = line.match(RE_MONTH_HEADER);
    if (header && !RE_DATE_MD.test(line) && !/\d{1,2}日/.test(line)) {
      RE_DATE_MD.lastIndex = 0;
      context.month = Number(header[2]);
      if (header[1]) context.year = Number(header[1]);
      continue;
    }
    RE_DATE_MD.lastIndex = 0;

    const dates = findDates(line, context);
    const times = findTimes(line);

    if (dates.length === 0) {
      // 時刻だけの行は直前の予定の続き
      const prev = events.at(-1);
      if (prev && times.length && prev.allDay) {
        prev.start = times[0].start;
        prev.end = times[0].end;
        prev.allDay = false;
        const extra = splitTitle(cut(line, times));
        const note = [extra.title, extra.note].filter(Boolean).join(" ");
        if (note) prev.note = [prev.note, note].filter(Boolean).join("、");
      } else {
        unparsed.push(line);
      }
      continue;
    }

    const first = dates[0];
    const spans = [{ index: first.index, length: first.length }];
    let periodNote = "";
    // 期間（10/3~10/5）は開始日 1 件にまとめ、メモに終了日を残す
    if (dates.length >= 2) {
      const between = line.slice(first.index + first.length, dates[1].index);
      if (/^\s*~\s*$/.test(between)) {
        const last = dates[1];
        spans.push({ index: first.index + first.length, length: last.index + last.length - (first.index + first.length) });
        periodNote = `~${last.m}/${last.d} まで`;
      }
    }
    // 日付直後の曜日
    RE_WEEKDAY.lastIndex = spans.at(-1).index + spans.at(-1).length;
    const wd = RE_WEEKDAY.exec(line);
    let weekday = null;
    if (wd && wd[1]) {
      weekday = wd[1];
      spans.push({ index: wd.index, length: wd[0].length });
    }

    const year = first.hasYear ? first.y : (first.y ?? resolveYear(first.m, first.d, today));
    const valid = isValidDate(year, first.m, first.d);
    const date = valid ? `${year}-${pad(first.m)}-${pad(first.d)}` : "";

    const time = times[0] ?? null;
    const rest = cut(line, [...spans, ...times]);
    const { title, note } = splitTitle(rest);

    let confidence = "medium";
    if (!valid || !title) confidence = "low";
    else if (weekday && weekdayOf(year, first.m, first.d) !== weekday) confidence = "low";
    else if (weekday || first.hasYear) confidence = "high";

    events.push({
      title: title || "（無題）",
      date,
      start: time?.start ?? null,
      end: time?.end ?? null,
      allDay: !time,
      note: [note, periodNote].filter(Boolean).join("、"),
      confidence,
      sourceLine: raw.trim(),
    });
  }
  return { events, unparsed };
}
