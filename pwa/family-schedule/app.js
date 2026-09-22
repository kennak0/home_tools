// エントリ。ログイン状態を見て画面を出し分け、ホーム（月カレンダー）・予定の追加編集・
// 読み取り（テキスト / 写真）・設定を配線する。
import { isUnlocked, mountLogin, logout } from "./login.js";
import { listEventsInRange, getEvent, putEvents, softDeleteEvent } from "./db.js";
import { createCalendar, iso, partsOf, todayISO, formatDay, formatTime, monthRange } from "./calendar.js";

const $ = (sel) => document.querySelector(sel);
const panes = {
  boot: $("#boot"),
  login: $("#login"),
  home: $("#home"),
  editor: $("#editor"),
  import: $("#import"),
  settings: $("#settings"),
};

// iOS の連打対策（touchstart の preventDefault）は日付マスなど連打する要素に付ける。
// document 全体に掛けると click が合成されずボタンが効かなくなる

function show(name) {
  for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
  panes[name].scrollTop = 0;
}

function setText(sel, text) {
  const el = $(sel);
  el.textContent = text;
  el.hidden = !text;
}

// --- ホーム: 月カレンダー + 選んだ日の予定 --------------------------------

let view = { year: 0, month: 0, selected: todayISO() };
let calendar = null;
let monthEvents = []; // 表示中の月の予定。日付一覧はここから絞る（月をまたぐまで読み直さない）

async function refresh() {
  const { from, to } = monthRange(view.year, view.month);
  monthEvents = await listEventsInRange(from, to);
  const counts = new Map();
  for (const ev of monthEvents) counts.set(ev.date, (counts.get(ev.date) ?? 0) + 1);
  calendar.render({ year: view.year, month: view.month, selected: view.selected, today: todayISO(), counts });
  renderDay();
}

function renderDay() {
  const events = monthEvents.filter((ev) => ev.date === view.selected);
  $("#day-title").textContent = formatDay(view.selected);
  $("#event-list").replaceChildren(
    ...events.map((ev) => {
      const li = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "row";
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = formatTime(ev);
      const body = document.createElement("span");
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = ev.title;
      body.append(title);
      if (ev.note) {
        const note = document.createElement("span");
        note.className = "note";
        note.textContent = ev.note;
        body.append(document.createElement("br"), note);
      }
      row.append(when, body);
      row.addEventListener("click", () => openEditor(ev));
      li.append(row);
      return li;
    }),
  );
  $("#event-empty").hidden = events.length > 0;
}

// 日付のタップ。同じ月なら DB を読み直さない
async function selectDate(date) {
  const { year, month } = partsOf(date);
  if (year !== view.year || month !== view.month) return goToDate(date);
  view.selected = date;
  calendar.render({ selected: date });
  renderDay();
}

// 指定の日に移って読み直す（保存・削除のあとや「今日」）
async function goToDate(date) {
  const { year, month } = partsOf(date);
  view = { year, month, selected: date };
  await refresh();
}

// 前月・次月。選んだ日も同じ月に移す（一覧と見えている月がずれないように）
function changeMonth({ year, month, select }) {
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(partsOf(view.selected).day, lastDay);
  view = { year, month, selected: select ?? iso(year, month, day) };
  refresh();
}

// --- 予定の追加・編集 ------------------------------------------------------

let editingId = null; // null = 新規

// 終日なら時刻は使わないので触れなくする
function syncAllDay() {
  const allDay = $("#ev-allday").checked;
  $("#ev-start").disabled = allDay;
  $("#ev-end").disabled = allDay;
}

function openEditor(ev) {
  editingId = ev?.id ?? null;
  $("#editor-title").textContent = ev ? "予定を編集" : "予定を追加";
  $("#ev-title").value = ev?.title ?? "";
  $("#ev-date").value = ev?.date ?? view.selected;
  $("#ev-allday").checked = ev ? Boolean(ev.allDay) : true;
  $("#ev-start").value = ev?.start ?? "";
  $("#ev-end").value = ev?.end ?? "";
  $("#ev-note").value = ev?.note ?? "";
  $("#editor-delete").hidden = !ev;
  setText("#editor-error", "");
  syncAllDay();
  show("editor");
  if (!ev) $("#ev-title").focus();
}

async function saveEditor() {
  setText("#editor-error", "");
  const save = $("#editor-save");
  if (save.disabled) return; // 二度押しで 2 件入れない
  const date = $("#ev-date").value;
  const allDay = $("#ev-allday").checked;
  const start = allDay ? null : $("#ev-start").value || null;
  const end = allDay ? null : $("#ev-end").value || null;
  if (!date) {
    setText("#editor-error", "日付を入れてください。");
    return;
  }
  if (!allDay && !start) {
    setText("#editor-error", "開始時刻を入れるか、「終日」にしてください。");
    return;
  }
  if (start && end && end < start) {
    setText("#editor-error", "終了時刻が開始より前になっています。");
    return;
  }
  save.disabled = true;
  try {
    const now = Date.now();
    // 編集のときは画面に出していない項目（members / remindBefore / source / createdAt）を引き継ぐ
    const base = editingId ? await getEvent(editingId) : null;
    await putEvents([
      {
        id: base?.id ?? crypto.randomUUID(),
        members: base?.members ?? [],
        remindBefore: base?.remindBefore ?? null,
        source: base?.source ?? "manual",
        createdAt: base?.createdAt ?? now,
        deleted: false,
        title: $("#ev-title").value.trim() || "（無題）",
        date,
        start,
        end,
        allDay,
        note: $("#ev-note").value.trim(),
        updatedAt: now,
      },
    ]);
    await goToDate(date); // 日付を変えた編集でも、保存した日に移って結果が見えるように
    show("home");
  } catch (e) {
    console.error(e);
    setText("#editor-error", "保存に失敗しました。");
  } finally {
    save.disabled = false;
  }
}

async function deleteEditing() {
  if (!editingId) return;
  const ev = monthEvents.find((e) => e.id === editingId) ?? (await getEvent(editingId));
  if (!confirm(`「${ev?.title ?? "この予定"}」を削除しますか？`)) return;
  await softDeleteEvent(editingId); // tombstone。同期を入れたとき削除が伝わるように
  await goToDate(view.selected);
  show("home");
}

// --- 読み取り ------------------------------------------------------------------

let importSource = "text"; // "text" | "photo"。保存する予定の source に入れる
let importGen = 0; // 読み取りの世代。「やめる」や次の写真でインクリメントし、遅れて届いた結果を捨てる
let ocrAbort = null;

function clearPreview() {
  const preview = $("#import-preview");
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.removeAttribute("src");
  preview.hidden = true;
}

function cancelImportWork() {
  importGen++;
  ocrAbort?.abort();
  ocrAbort = null;
}

function resetImport(title, source) {
  cancelImportWork();
  importSource = source;
  $("#import-title").textContent = title;
  setText("#import-status", "");
  setText("#import-error", "");
  $("#import-progress").hidden = true;
  clearPreview();
  $("#candidates").hidden = true;
  $("#import-run").disabled = false;
  $("#import-save").disabled = false;
  show("import");
}

function openTextImport(text = "") {
  resetImport("テキストから読み取る", "text");
  $("#import-text").value = text;
  $("#import-text").focus();
}

// 写真 → 縮小・グレースケール → OCR → textarea へ。ユーザーが直してから解析する
async function openPhotoImport(file) {
  resetImport("写真から読み取る", "photo");
  const gen = importGen;
  const abort = new AbortController();
  ocrAbort = abort;
  $("#import-text").value = "";
  const run = $("#import-run");
  const progress = $("#import-progress");
  run.disabled = true;
  try {
    const { preprocess, recognize } = await import("./ocr.js");
    const { blob, width, height } = await preprocess(file);
    if (gen !== importGen) return; // その間に「やめる」か別の写真
    const preview = $("#import-preview");
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false;
    setText("#import-status", `${width}×${height}px に縮小しました。文字を認識しています…（初回は辞書の読み込みに時間がかかります）`);
    progress.value = 0;
    progress.hidden = false;
    const text = await recognize(blob, (m) => {
      if (gen !== importGen) return;
      if (m.status === "recognizing text") progress.value = m.progress;
      else if (m.status === "loading language traineddata") setText("#import-status", "辞書を読み込んでいます…（初回だけ）");
    }, abort.signal);
    if (gen !== importGen) return;
    progress.hidden = true;
    $("#import-text").value = text;
    if (!text) {
      setText("#import-status", "文字を認識できませんでした。明るい場所で真上から撮り直すか、テキストを手で入れてください。");
    } else {
      setText("#import-status", "認識したテキストです。読み違いを直してから「予定を読み取る」を押してください。");
      runParse();
    }
  } catch (e) {
    if (gen !== importGen || e.name === "AbortError") return;
    console.error(e);
    progress.hidden = true;
    setText("#import-error", "写真を読み込めませんでした。");
  } finally {
    if (gen === importGen) {
      run.disabled = false;
      ocrAbort = null;
    }
  }
}

async function runParse() {
  setText("#import-error", "");
  const text = $("#import-text").value;
  if (!text.trim()) {
    setText("#import-error", "テキストを入れてください。");
    return;
  }
  const { parseEvents } = await import("./parse-events.js");
  const { events, unparsed } = parseEvents(text);
  renderCandidates(events, unparsed);
  $("#candidates").hidden = false;
  if (events.length === 0) {
    setText("#import-error", "日付のある行が見つかりませんでした。1 行に 1 つ、「10/3 遠足」のように書いてください。");
  }
  $("#candidates").scrollIntoView({ block: "start", behavior: "smooth" });
}

function field(labelText, input, className = "") {
  const wrap = document.createElement("div");
  wrap.className = className;
  const label = document.createElement("label");
  label.append(labelText, input); // label で包むとタップで input にフォーカスが移る
  wrap.append(label);
  return wrap;
}

function textInput(type, value, name) {
  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";
  input.dataset.name = name;
  return input;
}

function renderCandidates(events, unparsed) {
  const list = $("#candidate-list");
  const labels = { high: "確度 高", medium: "確度 中", low: "要確認" };
  list.replaceChildren(
    ...events.map((ev, i) => {
      const li = document.createElement("li");
      li.className = ev.confidence;
      li.dataset.index = i;

      const head = document.createElement("div");
      head.className = "head";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = ev.confidence !== "low" && Boolean(ev.date);
      check.dataset.name = "include";
      const src = document.createElement("span");
      src.className = "source";
      src.textContent = ev.sourceLine;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = labels[ev.confidence];
      head.append(check, src, badge);

      const grid = document.createElement("div");
      grid.className = "grid";
      const allDayWrap = document.createElement("div");
      allDayWrap.className = "allday";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = ev.allDay;
      cb.dataset.name = "allDay";
      const l = document.createElement("label");
      l.append(cb, "終日");
      allDayWrap.append(l);
      grid.append(
        field("タイトル", textInput("text", ev.title, "title"), "full"),
        field("日付", textInput("date", ev.date, "date")),
        allDayWrap,
        field("開始", textInput("time", ev.start, "start")),
        field("終了", textInput("time", ev.end, "end")),
        field("メモ", textInput("text", ev.note, "note"), "full"),
      );
      li.append(head, grid);
      return li;
    }),
  );
  const box = $("#unparsed-box");
  box.hidden = unparsed.length === 0;
  box.open = false;
  $("#unparsed-list").replaceChildren(
    ...unparsed.map((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      return li;
    }),
  );
}

function readCandidates() {
  const out = [];
  for (const li of $("#candidate-list").children) {
    const get = (name) => li.querySelector(`[data-name="${name}"]`);
    if (!get("include").checked) continue;
    const allDay = get("allDay").checked;
    out.push({
      title: get("title").value.trim() || "（無題）",
      date: get("date").value,
      start: allDay ? null : get("start").value || null,
      end: allDay ? null : get("end").value || null,
      allDay,
      note: get("note").value.trim(),
    });
  }
  return out;
}

async function saveCandidates() {
  setText("#import-error", "");
  const save = $("#import-save");
  if (save.disabled) return; // 二度押しで重複登録しない
  const rows = readCandidates();
  if (rows.length === 0) {
    setText("#import-error", "追加する予定にチェックを付けてください。");
    return;
  }
  if (rows.some((r) => !r.date)) {
    setText("#import-error", "日付が空の予定があります。");
    return;
  }
  save.disabled = true;
  try {
    const now = Date.now();
    await putEvents(
      rows.map((r) => ({
        id: crypto.randomUUID(),
        ...r,
        members: [],
        remindBefore: null,
        source: importSource,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      })),
    );
    cancelImportWork();
    clearPreview();
    await goToDate(rows.map((r) => r.date).sort()[0]); // 追加した中で一番早い日を開く
    show("home");
  } catch (e) {
    console.error(e);
    setText("#import-error", "保存に失敗しました。");
  } finally {
    save.disabled = false;
  }
}

// --- 起動 ----------------------------------------------------------------------

async function main() {
  calendar = createCalendar($("#calendar"), { onSelect: selectDate, onChangeMonth: changeMonth });
  const today = todayISO();
  const { year, month } = partsOf(today);
  view = { year, month, selected: today };

  let unlockedByLogin = false; // #code= の自動解錠が isUnlocked() より先に済んだときに login を出さないため
  mountLogin(panes.login, {
    onUnlocked: async () => {
      unlockedByLogin = true;
      await goToDate(todayISO());
      show("home");
    },
  });

  $("#photo-input").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // 同じ写真をもう一度選べるように
    if (file) openPhotoImport(file);
  });
  $("#open-text").addEventListener("click", () => openTextImport());
  $("#import-run").addEventListener("click", runParse);
  $("#import-save").addEventListener("click", saveCandidates);
  $("#import-cancel").addEventListener("click", () => {
    cancelImportWork();
    clearPreview();
    show("home");
  });

  $("#add-event").addEventListener("click", () => openEditor(null));
  $("#go-today").addEventListener("click", () => goToDate(todayISO()));
  $("#editor-cancel").addEventListener("click", () => show("home"));
  $("#editor-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    saveEditor();
  });
  $("#ev-allday").addEventListener("change", syncAllDay);
  $("#editor-delete").addEventListener("click", deleteEditing);

  $("#open-settings").addEventListener("click", () => show("settings"));
  $("#settings-close").addEventListener("click", () => show("home"));
  $("#logout").addEventListener("click", async () => {
    await logout();
    show("login");
    $("#passphrase").focus();
  });

  try {
    if ((await isUnlocked()) || unlockedByLogin) {
      await goToDate(todayISO());
      // iOS ショートカット「画像からテキストを抽出 → URL を開く」用: ?text=<encoded>
      const shared = new URL(location.href).searchParams.get("text");
      if (shared) {
        history.replaceState(null, "", location.pathname);
        openTextImport(shared);
      } else {
        show("home");
      }
    } else {
      show("login");
      $("#passphrase").focus();
    }
  } catch (e) {
    console.error(e);
    panes.boot.querySelector(".lead").textContent = "この端末では保存領域が使えません（プライベートブラウズ？）。";
  }
}

main();
