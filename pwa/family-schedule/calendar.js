// 月カレンダー（月表示）。日付は壁時計の "YYYY-MM-DD" 文字列で持ち、Date は
// 「その月が何日あるか」「1 日が何曜か」を出すためだけに使う（TZ に依存させない）。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const CELLS = 42; // 6 週 × 7 日。月によって行数が変わるとタップ位置がずれるので固定する

export function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function todayISO() {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function partsOf(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

export function weekdayOf(isoDate) {
  const { year, month, day } = partsOf(isoDate);
  return new Date(year, month - 1, day).getDay();
}

export function formatDay(isoDate) {
  const { month, day } = partsOf(isoDate);
  return `${month}月${day}日(${WEEKDAYS[weekdayOf(isoDate)]})`;
}

export function formatTime(ev) {
  if (ev.allDay || !ev.start) return "終日";
  return ev.end ? `${ev.start}–${ev.end}` : ev.start;
}

// 月の増減。month は 1..12
export function addMonths(year, month, delta) {
  const t = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(t / 12), month: (t % 12) + 1 };
}

// events.date インデックスで引くための範囲（両端を含む）
export function monthRange(year, month) {
  const last = new Date(year, month, 0).getDate();
  return { from: iso(year, month, 1), to: iso(year, month, last) };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// root に月カレンダーを組み立てる。戻り値の render(state) で中身を差し替える。
// state: { year, month, selected, today, counts: Map<"YYYY-MM-DD", 件数> }
// onSelect(iso) は日付のタップ、onChangeMonth({year, month}) は前月・次月のタップ。
//
// 日付マスに touchstart の preventDefault は付けない。同じ要素の click が合成されなくなり、
// タップが効かなくなる。iOS の選択バーは app.css の -webkit-touch-callout / user-select で抑える
export function createCalendar(root, { onSelect, onChangeMonth }) {
  root.classList.add("cal");
  const prev = el("button", "cal-nav", "‹");
  const next = el("button", "cal-nav", "›");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "前の月");
  next.setAttribute("aria-label", "次の月");
  const title = el("div", "cal-title");
  title.setAttribute("aria-live", "polite");
  const head = el("div", "cal-head");
  head.append(prev, title, next);

  const grid = el("div", "cal-grid");
  grid.setAttribute("role", "grid");
  for (const [i, w] of WEEKDAYS.entries()) {
    grid.append(el("div", `cal-wd${i === 0 ? " sun" : i === 6 ? " sat" : ""}`, w));
  }
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const cell = el("button", "cal-day");
    cell.type = "button";
    const day = el("span", "d");
    const dots = el("span", "dots");
    cell.append(day, dots);
    cell.addEventListener("click", () => {
      const date = cell.dataset.date;
      if (!date) return;
      const { year, month } = partsOf(date);
      // 前後の月のマスを押したらその月へ移る
      if (year !== state.year || month !== state.month) onChangeMonth?.({ year, month, select: date });
      else onSelect?.(date);
    });
    cells.push({ cell, day, dots });
    grid.append(cell);
  }
  root.append(head, grid);

  let state = { year: 0, month: 0, selected: null, today: null, counts: new Map() };

  prev.addEventListener("click", () => onChangeMonth?.(addMonths(state.year, state.month, -1)));
  next.addEventListener("click", () => onChangeMonth?.(addMonths(state.year, state.month, 1)));

  function render(nextState) {
    state = { ...state, ...nextState };
    const { year, month, selected, today, counts } = state;
    title.textContent = `${year}年${month}月`;
    const first = new Date(year, month - 1, 1).getDay();
    for (const [i, { cell, day, dots }] of cells.entries()) {
      // グリッドの i 番目が指す日を、その月の 1 日からの相対で出す
      const d = new Date(year, month - 1, 1 - first + i);
      const date = iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const inMonth = d.getMonth() + 1 === month && d.getFullYear() === year;
      cell.dataset.date = date;
      cell.classList.toggle("other", !inMonth);
      cell.classList.toggle("today", date === today);
      cell.classList.toggle("sun", d.getDay() === 0);
      cell.classList.toggle("sat", d.getDay() === 6);
      cell.setAttribute("aria-pressed", String(date === selected));
      cell.setAttribute("aria-label", `${formatDay(date)}${counts.get(date) ? ` 予定 ${counts.get(date)} 件` : ""}`);
      day.textContent = String(d.getDate());
      const n = Math.min(counts.get(date) ?? 0, 3); // 4 件以上でもドットは 3 つまで
      dots.replaceChildren(...Array.from({ length: n }, () => el("span", "dot")));
    }
  }

  return { render };
}
