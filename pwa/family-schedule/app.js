// エントリ。ログイン状態を見て画面を出し分け、ホーム・読み取り（テキスト / 写真）・設定を配線する。
// 月カレンダーはまだ無い。予定は日付順の一覧で出す。
import { isUnlocked, mountLogin, logout } from "./login.js";
import { listEvents, putEvents, softDeleteEvent } from "./db.js";

const $ = (sel) => document.querySelector(sel);
const panes = {
  boot: $("#boot"),
  login: $("#login"),
  home: $("#home"),
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

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${w})`;
}

// --- ホーム: 予定一覧 ------------------------------------------------------

async function renderEvents() {
  const list = $("#event-list");
  const events = await listEvents();
  list.replaceChildren(
    ...events.map((ev) => {
      const li = document.createElement("li");
      const when = document.createElement("div");
      when.className = "when";
      when.textContent = formatDate(ev.date) + (ev.allDay ? "" : `\n${ev.start ?? ""}${ev.end ? "–" + ev.end : ""}`);
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = ev.title;
      body.append(title);
      if (ev.note) {
        const note = document.createElement("div");
        note.className = "note";
        note.textContent = ev.note;
        body.append(note);
      }
      const del = document.createElement("button");
      del.type = "button";
      del.className = "secondary";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        if (!confirm(`「${ev.title}」（${formatDate(ev.date)}）を削除しますか？`)) return;
        del.disabled = true;
        await softDeleteEvent(ev.id);
        renderEvents();
      });
      li.append(when, body, del);
      return li;
    }),
  );
  $("#event-empty").hidden = events.length > 0;
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
    await renderEvents();
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
  let unlockedByLogin = false; // #code= の自動解錠が isUnlocked() より先に済んだときに login を出さないため
  mountLogin(panes.login, {
    onUnlocked: async () => {
      unlockedByLogin = true;
      await renderEvents();
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

  $("#open-settings").addEventListener("click", () => show("settings"));
  $("#settings-close").addEventListener("click", () => show("home"));
  $("#logout").addEventListener("click", async () => {
    await logout();
    show("login");
    $("#passphrase").focus();
  });

  try {
    if ((await isUnlocked()) || unlockedByLogin) {
      await renderEvents();
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
