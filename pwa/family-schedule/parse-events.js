// 段階 2: テキスト → 予定候補のルールベース解析。2a（貼り付け）も 2b（OCR）もここを通す。
// 依存なし・副作用なし。Node でも動くので pwa/tools/test-parse-events.mjs から直接テストできる。
//
// 1 行 = 1 予定を基本にする。行に日付が無く時刻だけあれば直前の予定に足す。
// 日付も時刻も無い行は unparsed に残し、UI で「読めなかった行」として見せる。

const WEEKDAYS = "日月火水木金土";
const GRACE_DAYS = 30; // 年が無い日付は「今日以降で最も近い」。ただし 30 日前までは今年扱い

// 全角 → 半角、揺れのある記号を寄せる。和暦・囲み曜日・「時半」もここで西暦・通常表記に
export function normalize(text) {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／]/g, "/")
    .replace(/[：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[〜～~‐‑–—―ｰ]/g, "~")
    .replace(/[　\t]+/g, " ")
    .replace(/\r/g, "")
    // 和暦: 令和8年 / R8. → 2026年 / 2026.
    .replace(/令和\s*(\d{1,2})\s*年/g, (_, y) => `${2018 + Number(y)}年`)
    .replace(/(?<![A-Za-z])R\s*(\d{1,2})\s*[.年]/g, (_, y) => `${2018 + Number(y)}.`)
    // ㈪〜㈰（U+322A–U+3230）→ (月)〜(日)
    .replace(/[㈪-㈰]/g, (c) => `(${"月火水木金土日"[c.charCodeAt(0) - 0x322a]})`)
    .replace(/時半/g, "時30分")
    // 行頭の丸数字・箇条書き記号
    .replace(/^[\s①-⑳●○■□◆◇・*\-]+(?=\S)/gm, "");
}

// 「日」を許すのは 月 表記のときだけ。「10/3 日帰り遠足」の 日 を食わないため
const RE_DATE_FULL = /(?:(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?|(\d{4})\s*([/.\-])\s*(\d{1,2})\s*\5\s*(\d{1,2}))/g;
const RE_DATE_MD = /(?<![\d/:])(?:(\d{1,2})\s*\/\s*(\d{1,2})|(\d{1,2})\s*月\s*(\d{1,2})\s*日?)(?![\d/:])/g;
const RE_DATE_D = /(?<![\d/:月])(\d{1,2})\s*日(?!間|後|前|以|目)/g;
// 曜日は「(土)」のように括弧付きか「土曜」のように 曜 が続くときだけ。裸の 1 字はタイトル（水泳、火災、日帰り）を食う
const RE_WEEKDAY = /\s*(?:\(\s*([月火水木金土日])\s*(?:曜日?)?\s*\)|([月火水木金土日])曜日?)/y;
const RE_MONTH_HEADER = /^(?:(\d{4})年)?\s*(\d{1,2})月(?!\d|\s*\d)/;
const TIME_CORE = "(午前|午後)?(\\d{1,2})(?::(\\d{2})|時(\\d{1,2})?分?)";
const TIME_TAIL = "(?!間|日|月|年|限|\\d)";
const RE_TIME = new RegExp(`${TIME_CORE}${TIME_TAIL}`, "g");
const RE_TIME_RANGE = new RegExp(`${TIME_CORE}\\s*[~\\-]\\s*${TIME_CORE}${TIME_TAIL}`, "g");

const pad = (n) => String(n).padStart(2, "0");

function toTime(ampm, h, m) {
  let hour = Number(h);
  const minute = Number(m ?? 0);
  if (ampm === "午後" && hour < 12) hour += 12;
  if (ampm === "午前" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
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

// 見出しの年は、見出しの月以降の月日にだけ当てる。「2026年12月の予定」の下の 1/8 は翌年
function yearFor(mo, day, context, today) {
  if (context.year && (!context.month || mo >= context.month)) return context.year;
  return resolveYear(mo, day, today);
}

// 行内の日付をすべて位置付きで拾う。context.month は「N日」だけの行に使う
function findDates(line, context, today) {
  const found = [];
  for (const m of line.matchAll(RE_DATE_FULL)) {
    const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[6], m[7]];
    found.push({ index: m.index, length: m[0].length, y: Number(y), m: Number(mo), d: Number(d), hasYear: true });
  }
  const covered = (i) => found.some((f) => i >= f.index && i < f.index + f.length);
  for (const m of line.matchAll(RE_DATE_MD)) {
    if (covered(m.index)) continue;
    const mo = Number(m[1] ?? m[3]);
    const d = Number(m[2] ?? m[4]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    found.push({ index: m.index, length: m[0].length, y: yearFor(mo, d, context, today), m: mo, d, hasYear: false });
  }
  if (context.month) {
    for (const m of line.matchAll(RE_DATE_D)) {
      if (covered(m.index)) continue;
      const d = Number(m[1]);
      if (d < 1 || d > 31) continue;
      found.push({ index: m.index, length: m[0].length, y: yearFor(context.month, d, context, today), m: context.month, d, hasYear: false });
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

function stripEdges(s) {
  return s
    .replace(/^[\s|｜・:、,。.~()\-]+/, "")
    .replace(/[\s|｜・:、,~(\-]+$/, "")
    .replace(/\(\s*\)/g, "")
    .trim();
}

// 残った文字列を タイトル / メモ に分ける。最初の空白か句読点まではタイトル
function splitTitle(rest) {
  const cleaned = stripEdges(rest);
  if (!cleaned) return { title: "", note: "" };
  const m = cleaned.match(/^(.+?)(?:\s+|(?<=[。])|\s*[|｜]\s*)(.*)$/s);
  if (!m) return { title: cleaned, note: "" };
  return { title: m[1].trim(), note: tidy(m[2]) };
}

function joinNote(...parts) {
  return parts.filter(Boolean).join("、");
}

export function parseEvents(text, { today = new Date() } = {}) {
  const context = { year: null, month: null };
  const events = [];
  const unparsed = [];

  for (const raw of normalize(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const dates = findDates(line, context, today);
    const times = findTimes(line);

    // 「10月の予定」「2026年10月」のような見出し → 月の文脈にする。行自体は unparsed にも残す
    const header = line.match(RE_MONTH_HEADER);
    if (header && dates.length === 0) {
      context.month = Number(header[2]);
      if (header[1]) context.year = Number(header[1]);
      unparsed.push(line);
      continue;
    }

    if (dates.length === 0) {
      // 時刻だけの行は直前の予定の続き
      const prev = events.at(-1);
      if (prev && times.length && prev.allDay) {
        prev.start = times[0].start;
        prev.end = times[0].end;
        prev.allDay = false;
        const extra = splitTitle(cut(line, [times[0]]));
        prev.note = joinNote(prev.note, tidy([extra.title, extra.note].filter(Boolean).join(" ")));
      } else {
        unparsed.push(line);
      }
      continue;
    }

    const first = dates[0];
    const spans = [{ index: first.index, length: first.length }];
    const notes = [];

    // 日付直後の曜日（括弧付きか「曜」付きだけ）
    const weekdayAfter = (pos) => {
      RE_WEEKDAY.lastIndex = pos;
      const wd = RE_WEEKDAY.exec(line);
      return wd ? { weekday: wd[1] ?? wd[2], index: wd.index, length: wd[0].length } : null;
    };
    let weekday = null;
    const wd1 = weekdayAfter(first.index + first.length);
    if (wd1) {
      weekday = wd1.weekday;
      spans.push({ index: wd1.index, length: wd1.length });
    }

    // 期間（10/3(土)~10/5(月)）は開始日 1 件にまとめ、メモに終了日を残す。
    // 「・」「、」で並んだ複数日付は 2 つ目以降をメモに落とす（別々の予定にはしない）
    let cursor = spans.at(-1).index + spans.at(-1).length;
    for (let i = 1; i < dates.length; i++) {
      const d = dates[i];
      const between = line.slice(cursor, d.index);
      const wdN = weekdayAfter(d.index + d.length);
      const label = `${d.m}/${d.d}${wdN ? `(${wdN.weekday})` : ""}`;
      if (/^\s*[~\-]\s*$/.test(between)) {
        notes.push(`~${label} まで`);
      } else if (/^\s*[・、,]\s*$/.test(between)) {
        notes.push(`${label} も`);
      } else {
        break; // 文中の日付（「雨天は 10/19 に順延」）はメモの文章として残す
      }
      const end = wdN ? wdN.index + wdN.length : d.index + d.length;
      spans.push({ index: cursor, length: end - cursor });
      cursor = end;
    }

    const year = first.y;
    const valid = isValidDate(year, first.m, first.d);
    const date = valid ? `${year}-${pad(first.m)}-${pad(first.d)}` : "";

    // 時刻は最初の 1 つを予定に使い、残り（開門 8:30 開会 9:00 など）はメモに残す
    const time = times[0] ?? null;
    const rest = cut(line, time ? [...spans, time] : spans);

    // 日付より前の文字列（「1年生」「第2回」）はメモに回し、日付より後ろをタイトルにする
    const firstCut = Math.min(...spans.map((s) => s.index));
    const beforeLen = firstCut; // cut は元の位置を保つので、先頭 firstCut 文字が「日付より前」
    const before = stripEdges(rest.slice(0, beforeLen));
    const after = rest.slice(beforeLen);
    let { title, note } = splitTitle(after);
    if (!title && before) {
      // 「第2回 保護者会 10/3(土)」: 日付の前しか無ければ最後の語をタイトル、手前をメモに
      const chunks = before.split(/\s+/);
      title = chunks.pop();
      note = tidy(chunks.join(" "));
    } else if (before) {
      notes.unshift(before);
    }

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
      note: joinNote(...notes.filter((n) => !n.endsWith(" まで") && !n.endsWith(" も")), note, ...notes.filter((n) => n.endsWith(" まで") || n.endsWith(" も"))),
      confidence,
      sourceLine: raw.trim(),
    });
  }
  return { events, unparsed };
}
