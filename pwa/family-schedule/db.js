// IndexedDB ラッパ。スキーマは README「データモデル」。
// settings は端末内の秘密（トークン類）も入るので、読んだ値を DOM に入れない。
const DB_NAME = "family-schedule";
const DB_VERSION = 1;

let dbPromise;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("events")) {
          const events = db.createObjectStore("events", { keyPath: "id" });
          events.createIndex("date", "date");
          events.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("members")) {
          db.createObjectStore("members", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 別タブが新しい DB version で開こうとしたら閉じて譲る（upgrade を block しない）
        db.onversionchange = () => {
          db.close();
          dbPromise = undefined;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    });
    // 失敗を持ち越さない（プライベートブラウズ解除後などに再試行できるように）
    dbPromise.catch(() => { dbPromise = undefined; });
  }
  return dbPromise;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export async function getSetting(key) {
  const db = await openDb();
  const row = await request(db.transaction("settings").objectStore("settings").get(key));
  return row?.value;
}

// 複数の設定をひとつのトランザクションで書く（config.enc の中身を丸ごと入れる用）
export async function putSettings(entries) {
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  const store = tx.objectStore("settings");
  for (const [key, value] of Object.entries(entries)) store.put({ key, value });
  await done(tx);
}

export async function clearSettings() {
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").clear();
  await done(tx);
}

// --- events ---------------------------------------------------------------

export async function putEvents(events) {
  const db = await openDb();
  const tx = db.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  for (const ev of events) store.put(ev);
  await done(tx);
}

// 終日を先に、次に開始時刻順。同着はタイトル順（描画のたびに並びが変わらないように）
const byWhen = (a, b) =>
  a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title);

// 削除済み（tombstone）を除き、日付・開始時刻順で返す
export async function listEvents() {
  const db = await openDb();
  const all = await request(db.transaction("events").objectStore("events").getAll());
  return all.filter((ev) => !ev.deleted).sort(byWhen);
}

// 月表示用。events.date インデックスの範囲で引く（全件読まない）。両端を含む
export async function listEventsInRange(from, to) {
  const db = await openDb();
  const index = db.transaction("events").objectStore("events").index("date");
  const rows = await request(index.getAll(IDBKeyRange.bound(from, to)));
  return rows.filter((ev) => !ev.deleted).sort(byWhen);
}

export async function getEvent(id) {
  const db = await openDb();
  const ev = await request(db.transaction("events").objectStore("events").get(id));
  return ev && !ev.deleted ? ev : undefined;
}

export async function softDeleteEvent(id) {
  const db = await openDb();
  const tx = db.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  // get の onsuccess から同じ tx で put する。間に別の await（fetch 等）を挟むと tx が閉じて TransactionInactiveError
  const ev = await request(store.get(id));
  if (ev) store.put({ ...ev, deleted: true, updatedAt: Date.now() });
  await done(tx);
}
