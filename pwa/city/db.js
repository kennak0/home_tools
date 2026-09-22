// IndexedDB。セーブは 1 スロットだけ（README「データモデル」）。
// TypedArray は structured clone でそのまま入るので、配列に展開しない。
const DB_NAME = "city";
const DB_VERSION = 1;
const SLOT = "slot1";

let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        // 別タブが新しい version で開こうとしたら閉じて譲る
        db.onversionchange = () => { db.close(); dbPromise = undefined; };
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

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export async function loadCity() {
  const db = await openDb();
  const tx = db.transaction("saves", "readonly");
  const req = tx.objectStore("saves").get(SLOT);
  await done(tx);
  return req.result ?? null;
}

export async function saveCity(city) {
  const db = await openDb();
  const tx = db.transaction("saves", "readwrite");
  tx.objectStore("saves").put({
    id: SLOT,
    seed: city.seed,
    terrain: city.terrain,
    build: city.build,
    zone: city.zone,
    funds: city.funds,
    savedAt: new Date().toISOString(),
  });
  await done(tx);
}

export async function clearCity() {
  const db = await openDb();
  const tx = db.transaction("saves", "readwrite");
  tx.objectStore("saves").delete(SLOT);
  await done(tx);
}
