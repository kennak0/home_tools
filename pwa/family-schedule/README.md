# family-schedule — 家族の予定表 PWA

家族で使う予定表。iPhone のホーム画面に追加して、ネイティブアプリのように
1 秒以内に開く。[PWAs: Personal Web Apps](https://ma.ttias.be/pwas-personal-web-apps/)
の作り方に倣う。実装の規則は `.claude/skills/offline-first-pwa/SKILL.md`、
`pwa/` 共通の決め事は `.claude/AGENTS.md` の「PWA 開発ガイド」を参照。
このファイルは**このアプリ固有の仕様と判断**の正本。

## 状態

段階 1 の途中。ログイン画面（`config.enc` の復号 → settings 保存 → ログアウト）まで
実装済みで、GitHub Pages に配信する Actions（`.github/workflows/pages.yml`）も置いた。
**service worker と manifest はまだ無い**（普通の Web ページとして動く。オフライン起動・
更新バナーは無し）。予定表本体に着手するときに `sw.js` と生成スクリプトを足す。
それまで家族には配らない。

## 段階

| 段階 | 内容 | 同期 |
|---|---|---|
| **1（いま）** | 端末内だけで動く予定表。登録・編集・削除、メンバー別の色分け、アプリを開いている間のリマインダー | なし（端末ごとに独立） |
| 2 | 写真・プリントから予定を読み取る。2a テキスト貼り付け → 2b 端末内 OCR → 2c Claude API の順に足す（下の「段階 2」） | 2a・2b はなし。2c はユーザー操作時のみ Anthropic API へ |
| 3 | 家族の端末間で同期 | 未定。第一候補は GitHub の非公開リポジトリを DB にする（下の「同期方式の候補」） |
| 4 | アプリを閉じていても届くリマインダー（Web Push） | 段階 3 に相乗り（GitHub なら Actions の cron から送る） |

段階 1 の時点では「家族で共有」はできない（各自の端末に別々のデータが
できる）。同期方式を決めるまで、データモデルだけ同期を見越して作る。

## 段階 1 の機能

### 予定

- 登録・編集・削除
- 項目: タイトル、日付、開始・終了時刻（省略で終日）、メンバー、メモ
- 表示: 月カレンダー + 選択日の一覧。まず月表示だけ、週表示は要望が出てから
- 削除は tombstone（`deleted: true`）で残す。同期を入れたとき削除が伝播できるように

### メンバー

- 家族のメンバーを登録し、色を割り当てる（名前・色・並び順）
- 予定にメンバーを 0 人以上つける。0 人は「家族全員」扱い
- カレンダーのマスにはメンバー色のドットを出す

### リマインダー（段階 1 の範囲）

- 予定に「n 分前」を設定できる
- **アプリを開いている間だけ** `setTimeout` + Notification API で通知する
- iOS で通知を出すにはホーム画面に追加した状態（standalone）で、かつ
  ユーザー操作をきっかけに `Notification.requestPermission()` を呼ぶ必要がある
- **アプリを閉じている間は鳴らない。** Web には「時刻を指定してローカル通知を
  予約する」API がない（Notification Triggers は標準化されず廃止）。
  閉じていても届かせるには Web Push が要り、Push を送るサーバが要る → 段階 4

## ログイン（家族の共有コード）

初回起動時に「家族の合言葉」を入力しないとアプリに入れないようにする。
ただし**合言葉の照合だけを目的にしない**。公開サイトなので、アプリのコードは
誰でも読めるし、弱いコードのハッシュを置けばその場で破られる。合言葉には
「端末に置く秘密（トークン類）を解錠する鍵」という実の仕事を持たせる。

### 仕組み

```
config.enc（公開サイトに置く。中身は AES-GCM で暗号化した JSON）
  ├── 段階 1: { "ok": true }                     ← 復号できれば合言葉が正しい
  ├── 段階 2c: + "anthropicApiKey"（任意。家族で共有するなら）
  └── 段階 3: + "githubToken"（データリポジトリの PAT）

合言葉 ──PBKDF2-SHA256（600,000 回、salt は config.enc に同梱）──▶ AES-GCM 鍵
       ──▶ config.enc を復号 ──▶ 中身を IndexedDB の settings に保存 ──▶ 以後は聞かない
```

- WebCrypto（`crypto.subtle`）だけで実装できる。ライブラリ不要
- 合言葉は**端末ごとに 1 回**入力すれば済む。毎回の起動で聞くと「1 秒で開く」
  が壊れる。設定画面の「ログアウト」で settings を消し、次回また聞く
- `config.enc` は所有者が手元で作る（`pwa/tools/make-config.mjs`。合言葉と
  中身の JSON を渡すと暗号化ファイルを出す）。**合言葉と平文の JSON はリポジトリに
  置かない**。暗号化済みの `config.enc` だけコミットする
- 合言葉を変える = `config.enc` を作り直してコミットし、家族に入れ直してもらう。
  トークンを失効させたときも同じ手順

### `config.enc` の形式（v1）と作り方

```json
{ "v": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64 16B>" },
  "cipher": "AES-GCM", "iv": "<base64 12B>", "ct": "<base64>" }
```

`ct` を復号した平文は JSON オブジェクトで、キーがそのまま IndexedDB の `settings` に
入る（段階 1 は `{ "ok": true }`）。合言葉違いは AES-GCM の認証失敗になるので、
別途ハッシュを置く必要はない。復号側は `login.js`、生成側は `pwa/tools/make-config.mjs`。

```bash
node pwa/tools/make-config.mjs \
  --out pwa/family-schedule/config.enc \
  --passphrase-file ~/.config/home_tools/family-schedule.passphrase \
  [--in pwa/family-schedule/config.plain.json]   # 省略時は { "ok": true }
```

- 合言葉は 5 文字 × 4 組（紛らわしい文字を除いた 31 種、約 99 bit）を生成し、
  `--passphrase-file` に mode 0600 で書く。**画面には出さない**（ターミナルのログに
  残さないため）。家族に伝えるときはそのファイルを開く
- `--passphrase-file` が既にあればその合言葉を使い回す。中身を足して作り直しても
  家族の入れ直しは要らない。合言葉を変えるときはファイルを消してから実行する
- `config.plain.json` は `.gitignore` で除外済み。`config.enc` だけコミットする

### 合言葉の強さ

`config.enc` は公開サイトに置くので、誰でもダウンロードしてオフラインで総当たり
できる。防げるのは合言葉の長さだけ。

- **ランダムな 5 語以上**（例: `tsukue-hamaki-ringo-kaeru-tsubame`、約 64 bit）か、
  ランダムな 16 文字以上。人が思いつく短い言葉や生年月日は不可
- PBKDF2 600,000 回で 1 回の試行に手元の iPhone で 0.5〜1 秒。64 bit なら総当たりは
  現実的でない
- `make-config.mjs` が合言葉を生成する（自分で考えさせない）

### 守れるもの・守れないもの

| | |
|---|---|
| 守れる | URL を知った他人がトークンを手に入れること。段階 3 でデータリポジトリに書き込まれること |
| 守れない | アプリの見た目・コードを見られること（公開サイト）。**ロック解除済みの iPhone を触られること**（それは iPhone のロックの仕事） |

段階 1 の時点では守るべき秘密がまだ無いので、この画面は「家族専用の入口」という
体裁と、段階 3 に備えた仕組みの先行実装という位置づけになる。

## データモデル

IndexedDB（DB 名 `family-schedule`）。`localStorage` は使わない。

```js
// store: events  (keyPath: id)
{
  id: "uuid",            // crypto.randomUUID()
  title: "歯医者",
  date: "2026-10-03",    // 壁時計。TZ は Asia/Tokyo 固定
  start: "15:30",        // 省略可。start/end とも無ければ終日
  end: "16:00",
  allDay: false,
  members: ["uuid"],     // members.id の配列。空 = 家族全員
  note: "",
  remindBefore: 30,      // 分。null = なし
  source: "manual",      // "manual" | "photo"（段階 2）
  createdAt: 1700000000000,
  updatedAt: 1700000000000,  // 同期の衝突解決用（last-write-wins 予定）
  deleted: false         // tombstone
}

// store: members  (keyPath: id)
{ id: "uuid", name: "父", color: "#3b82f6", order: 0, updatedAt, deleted }

// store: settings (keyPath: key)   すべて端末内のみ。「ログアウト」で全消し
{ key: "unlocked", value: true }            // 共有コードで config.enc を復号済み
{ key: "anthropicApiKey", value: "..." }   // 段階 2c
{ key: "githubToken", value: "..." }       // 段階 3
```

インデックス: `events.date`（月表示の範囲取得）、`events.updatedAt`（同期の差分取得）。

## ファイル構成（✓ は実装済み）

```
pwa/family-schedule/
├── index.html           ✓ 起動ページ。standalone 判定の inline script を <head> に置く。ログイン画面と仮のホーム画面
├── app.js               ✓ エントリ（ES module）。unlocked を見て画面を出し分ける
├── app.css              ✓ 共通スタイル（safe-area、100dvh の flex column、iOS の選択バー対策）
├── login.js             ✓ 共有コード入力 → PBKDF2 → config.enc 復号 → settings 保存。ログアウト
├── config.enc           ✓ 暗号化済み設定（これだけコミットする。平文と合言葉は置かない）
├── db.js                ✓ IndexedDB ラッパ（events / members / settings。v1 で全ストア作成済み）
├── calendar.js            月表示
├── sw.js                  service worker（precache 一覧と VERSION は生成）
├── manifest.webmanifest   name / icons / start_url と scope（GitHub Pages では末尾スラッシュあり。「ホスティング」参照）
├── icons/                 apple-touch-icon 含む
├── parse-events.js        段階 2。テキスト → 予定候補のルールベース解析（2a/2b/2c 共通）
├── ocr.js                 段階 2b。Tesseract.js の呼び出し。dynamic import
├── vendor/tesseract/      段階 2b。Tesseract.js 本体・worker・WASM・jpn.traineddata（precache 対象外）
└── photo-import.js        段階 2c。dynamic import で起動時には読まない

pwa/tools/
├── make-config.mjs      ✓ config.enc の生成（「ログイン」参照）
├── serve.mjs            ✓ 開発用の静的サーバ。`node pwa/tools/serve.mjs` で pwa/ を http://localhost:8080/ に
├── slow-proxy.mjs         応答前に sleep するリバースプロキシ（遅い回線の再現）
└── build-sw.mjs           precache 一覧と VERSION を sw.js に埋める
```

## ホスティング（GitHub Pages を第一候補）

段階 1・2 は静的ファイルだけなので GitHub Pages で動く。ただし次の制約がある。

### GitHub Pages で決まること

| 項目 | 内容 |
|---|---|
| URL | `https://kennak0.github.io/home_tools/family-schedule/`（リポジトリ `kennak0/home_tools`。git で追跡するのは `pwa/` だけなので、このリポジトリをそのまま配信用にする）。無料プランで Pages を使うには**公開リポジトリ**にする必要がある。公開したくなければ GitHub Pro にするか Cloudflare Pages にする |
| オリジン | `kennak0.github.io` は他の Pages サイトと共有のオリジン。**後からカスタムドメインに変えるとホーム画面のアイコンが古いオリジンに残る**（SKILL.md「Moving an app to another origin」）。家族に配る前にドメインを決める |
| `scope` / `start_url` | **末尾スラッシュあり** `/home_tools/family-schedule/`。SKILL.md は「スラッシュなし」を勧めるが、それには `Service-Worker-Allowed` ヘッダーが要り、GitHub Pages はレスポンスヘッダーを設定できない。Pages はスラッシュなしの URL を 301 でスラッシュありに飛ばすので、実害はない |
| `sw.js` の HTTP キャッシュ | 全ファイルに `Cache-Control: max-age=600` が付き、変更できない。worker 本体の更新チェックはブラウザが HTTP キャッシュを迂回するので問題ないが、`sw.js` から `importScripts()` したファイルは 10 分キャッシュされる。**`sw.js` は 1 ファイルにまとめ、`importScripts` を使わない** |
| ハッシュ付きアセットの `immutable` | 付けられない。`max-age=600` のまま。precache は worker のバージョンで管理するので実害なし |
| 公開範囲 | サイトは誰でも開ける。段階 1 はデータが端末内だけなので問題ない。段階 3 で同期を入れるときは別途サーバと認証が要る（Pages にはサーバがない） |
| デプロイ | `.github/workflows/pages.yml`（実装済み）。`main` への push で `pwa/` 配下だけを `actions/upload-pages-artifact` → `actions/deploy-pages`。`pwa/tools/` と `*.md` は載せない。**リポジトリのルートを公開しない**（`TODO.md` や個人のメモが載る）。有効化は Settings → Pages → Source を **GitHub Actions** にする。precache 一覧と worker のバージョン生成は将来 Actions 内で `node` を回す |

### 代替: Cloudflare Pages

非公開リポジトリのまま使え、`_headers` ファイルでレスポンスヘッダーを設定できる
（`Service-Worker-Allowed`, `Cache-Control` とも）。段階 3 の Workers + D1、
段階 4 の Push 送信もここに置ける。GitHub Pages で始めて段階 3 で移るなら、
オリジンが変わるので**家族がインストールする前に決める**。

## 非交渉の要件（記事と SKILL.md から）

- cache から 1 秒以内に起動。ナビゲーションは cache-first
- 新版はバックグラウンドで取り、「新しいバージョンがあります」バナー →
  タップで reload。`visibilitychange` と 1 時間ごとに `registration.update()`
- `viewport-fit=cover`。上端は `max(env(safe-area-inset-top), 12px)` で空ける
- ページ自体はスクロールしない（`100dvh` の flex column、中身の pane だけ scroll）
- Web フォント・CDN・外部スクリプトなし
- インストール案内は iOS の共有シート手順を表示（`beforeinstallprompt` は iOS にない）。
  standalone なら出さない、閉じたら記憶する
- 連打する UI（日付マス、＋ボタン）に iOS の「コピー / 調べる」バーが出ないよう
  `touchstart` で `preventDefault()` + `-webkit-touch-callout: none` など

## 外部送信

| いつ | 何を | どこへ | 段階 |
|---|---|---|---|
| 「写真から予定を読み取る（Claude）」を押したとき | 選んだ写真 1 枚（端末内で縮小・EXIF 除去済み）と指示文 | `https://api.anthropic.com/v1/messages` | 2c |
| 端末内 OCR を初めて使うとき | なし（辞書ファイルを自分のオリジンから取るだけ） | 自分のオリジン | 2b |

それ以外の通信は自分のオリジンからアプリ本体と `config.enc` を取るだけ。

## 段階 2: 写真・プリントから予定を読み取る

学校のプリントや案内から予定候補を抽出し、**ユーザーが確認してから**保存する。
自動では入れない。入力の取り方は 3 通りあり、この順に足す。**どの経路でも
最後は同じ「テキスト → 予定候補」のルールベース解析（`parse-events.js`）を通す。**

| 経路 | OCR をやる場所 | 外部送信 | 精度 | 追加サイズ |
|---|---|---|---|---|
| 2a テキスト貼り付け | iOS の写真アプリ（テキスト認識表示 / Live Text）。ユーザーが文字を選んでコピーし、アプリに貼る | なし | 日本語の印刷物なら高い（Apple の OCR） | 0 |
| 2b 端末内 OCR | アプリ内の Tesseract.js（WASM） | なし | 印刷物の横書きなら実用。斜め・影・表組み・手書きに弱い | 本体 + 日本語辞書 約 2MB（fast）〜16MB（best）。初回だけ取得して Cache API に置く |
| 2c Claude API | Anthropic のサーバ | 写真 1 枚 | 高い。表・年の省略・手書きも読む | 0 |

### 2a: テキスト貼り付け（最初に作る）

- 画面に「テキストから読み取る」の textarea を置く。iOS の写真アプリで文字を
  選択 → コピー → 貼り付け → 解析 → 候補の確認画面
- iOS の共有シートから直接渡すなら、ショートカット「画像からテキストを抽出」→
  「URL を開く」で `…/family-schedule/?text=<encoded>` を開く。URL の長さに
  上限があるので長文は貼り付けに倒す
- 通信ゼロ、追加サイズゼロで、`parse-events.js` の出来を先に詰められる。
  **2b・2c を作る前にこれで解析ルールを育てる**

### 2b: 端末内 OCR（Tesseract.js）

- [Tesseract.js](https://github.com/naptha/tesseract.js)（v7 系）を `pwa/family-schedule/vendor/`
  に**ファイルとして置く**（CDN から読まない。オフラインと precache の規則）。
  worker と WASM と `jpn.traineddata` はサイズが大きいので precache 一覧から外し、
  初回に「読み取る」を押したとき自分のオリジンから取って Cache API に保存する
  （起動の critical path に載せない。SKILL.md「Precaching」の例外として README に明記）
- 辞書は `jpn`（横書き）。縦書きのプリントは `jpn_vert` を足す。fast 版（約 2MB）
  で始め、読めなければ best 版（約 16MB）を試す
- 前処理で精度が大きく変わる: 長辺 2000px 程度に縮小、グレースケール化、
  必要なら二値化。canvas で行う
- 精度の限界はアプリ内で正直に出す。「読めなかった行」を残して、ユーザーが直せる UI にする
- Tesseract も機械学習モデル（LSTM）だが、端末内で完結し外部送信がない点で 2c と区別する

### 2c: Claude API

写真をそのまま送り、モデルに構造化 JSON で返させる。2a・2b で読めない
（表組み、手書き、写真の質が悪い）ときの手段。以下はこの経路の設計。


### 認証

- **Claude Code のログイン（サブスクリプションの OAuth トークン）は使えない。**
  Claude Code / Agent SDK の外で使うことは Anthropic の利用条件で認められていない。
  トークン自体も短命でローテーションするので、アプリに埋めても動き続けない。**Console
  (<https://platform.claude.com/>) で発行する API キー**（従量課金）を使う
- キーは専用の Workspace で発行し、月の上限額を設定する。漏れたときの被害を
  そこで止める
- キーはユーザーが設定画面で入力し、IndexedDB の `settings` に端末内保存する。
  コード・リポジトリ・ビルド成果物には置かない。保存後は input を空にする
- 家族の他の端末にもそれぞれ入れる。段階 3 でサーバができたら、キーはサーバ側へ
  移して端末からは消す

### 呼び方

- ブラウザから `fetch` で直接 `POST https://api.anthropic.com/v1/messages`。
  ヘッダーは `x-api-key`, `anthropic-version: 2023-06-01`,
  `anthropic-dangerous-direct-browser-access: true`, `content-type: application/json`。
  API 側は `Access-Control-Allow-Origin: *` を返すので CORS は通る（2026-09-22 に
  preflight で確認済み）
- 公式 SDK (`@anthropic-ai/sdk`) はバンドラが要るので、ビルドなしの方針と合わない。
  バンドラを入れる判断をしたら SDK (`dangerouslyAllowBrowser: true`) に切り替える
- `photo-import.js` は dynamic import。起動時の critical path に載せない
- オフライン時はボタンを無効化する。キューに溜めて後で送る、はしない
  （写真を端末に持ち続ける理由がない）

### 画像の前処理（端末内）

- `<input type="file" accept="image/*" capture="environment">` で撮影 or 選択
- canvas で長辺 **1568px** に縮小し JPEG (quality 0.85) にする。
  canvas を通すと EXIF（位置情報など）が落ちる
- 1568px は標準解像度の上限。モデルが高解像度対応でもここまで下げてよい:
  1 枚 ≒ 1,500 visual tokens 前後で、プリントの文字は十分読める。
  読めなかったら 2576px を試す（トークンは約 3 倍）
- 対応形式は JPEG / PNG / GIF / WebP。HEIC は iOS Safari の file input が
  JPEG に変換して渡す

### リクエスト

- モデルは `claude-opus-5` を既定にする。安く済ませたいとき `claude-haiku-4-5`
  へ切り替えられるよう、設定画面で選べるようにする
- 画像ブロックを先、指示文を後に置く
- 指示文に「今日の日付」「家族のメンバー名一覧」「年が書いてなければ次に来る
  同月日」を含める。年の省略はプリントで頻出
- 出力は `output_config.format` の JSON Schema で固定する:

```json
{
  "type": "object",
  "properties": {
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title":   { "type": "string" },
          "date":    { "type": "string", "description": "YYYY-MM-DD" },
          "start":   { "type": ["string", "null"], "description": "HH:MM" },
          "end":     { "type": ["string", "null"] },
          "allDay":  { "type": "boolean" },
          "member":  { "type": ["string", "null"], "description": "メンバー名。不明なら null" },
          "note":    { "type": "string" },
          "confidence": { "type": "string", "enum": ["high", "medium", "low"] }
        },
        "required": ["title", "date", "start", "end", "allDay", "member", "note", "confidence"],
        "additionalProperties": false
      }
    }
  },
  "required": ["events"],
  "additionalProperties": false
}
```

- `stop_reason` を見る。`refusal` と `max_tokens` は「読み取れませんでした」に落とす
- 429 / 5xx は 1 回だけ待って再試行。それ以外はそのままエラー表示

### UI

1. 写真を選ぶ → 縮小プレビュー → 「読み取る」
2. 候補一覧（confidence `low` は目立たせる）。1 件ずつ編集・除外できる
3. 「追加」で選んだ分だけ `events` に入れる（`source: "photo"`）

### 費用の目安

1 枚あたり画像 1,500 tokens + 指示文 500 tokens、出力 300 tokens と見積もる。

| モデル | 入力 | 出力 | 1 枚あたり |
|---|---|---|---|
| claude-opus-5 | $5/M | $25/M | 約 $0.018（≒ 3 円） |
| claude-haiku-4-5 | $1/M | $5/M | 約 $0.004（≒ 0.6 円） |

家族で月に数十枚なら、どちらでも月 100 円に届かない。

## 同期方式の候補（段階 3、未決）

| 方式 | 利点 | 欠点 |
|---|---|---|
| **GitHub リポジトリを DB にする**（下に設計） | サーバも新しいアカウントも要らない。無料。Pages と同じ GitHub で完結。段階 4 の Push も Actions の cron で送れる | 保存に 1〜2 秒かかる。データは git 履歴に永久に残る。同時編集の衝突は自前で解く。同期を「即時」にはできない |
| Cloudflare Pages + Workers + D1 | 無料枠で足りる。静的ホスティングと同居。段階 2c の API キーと段階 4 の Push サーバもここに置ける | Cloudflare アカウントが要る。Workers のコードを書いて運用する |
| 自宅サーバ（Tailscale + SQLite） | 外部依存なし | 家の機器を常時動かす運用 |
| Google カレンダー連携 | 既存の共有カレンダーが使える | OAuth とオフライン書き込みキューが重い。Google API JS が offline-first と相性が悪い |

同期の衝突は `updatedAt` の last-write-wins で始める。家族の予定表で同じ予定を
同時に編集することはまずない。

### GitHub リポジトリを DB にする設計

アプリ（ブラウザ）から GitHub REST API の Contents エンドポイントを直接叩き、
JSON ファイルをコミットする。`api.github.com` は `Access-Control-Allow-Origin: *`
を返すので、静的サイトからの `PUT` が通る（2026-09-22 に preflight で確認済み）。

**リポジトリを 2 つに分ける。**

| リポジトリ | 公開範囲 | 中身 |
|---|---|---|
| `home_tools`（配信用。このリポジトリ） | 公開（無料プランで Pages を使う条件） | アプリ本体だけ（`pwa/`）。データは置かない |
| `family-schedule-data` | **非公開** | `events.json` `members.json`。段階 4 で `subscriptions.json` |

家族の予定を公開リポジトリに置くと誰でも読めてしまう。データ側を非公開にすれば
API はトークンで読み書きできるし、Pages のビルドも走らない（配信用リポジトリに
コミットすると毎回 Pages が再デプロイされ、worker のバージョンも変わってしまう）。

**認証はフィルグレインの Personal Access Token。** ブラウザだけの OAuth は
client secret を隠せないので使えない。

- 所有者が発行する。`config.enc` で配るなら家族で 1 本、端末を失くしたら
  作り直して合言葉ごと配り直す
- 権限は `family-schedule-data` の **Contents: Read and write のみ**。有効期限は最長 1 年で、
  切れたら入れ直す
- `config.enc` に入れて配る（「ログイン」参照）。家族は合言葉を 1 回入れるだけで、
  PAT を端末ごとに貼る手間がない。その代わり PAT は家族で 1 本になるので、失効は
  全員の入れ直しになる。端末ごとに分けたければ設定画面からの手入力も残す

**読み書き。**

```
GET  /repos/<owner>/family-schedule-data/contents/events.json
     Accept: application/vnd.github.raw+json   → 本文そのまま。ETag / sha を控える
PUT  /repos/<owner>/family-schedule-data/contents/events.json
     { message, content: base64(json), sha: <控えた sha> }
```

- 保存のたびに 1 コミット。`sha` が古いと 409 が返るので、**取り直して
  マージしてから再 PUT**（数回で諦めてエラー表示）
- マージはレコード単位の last-write-wins（`updatedAt` の大きい方）。削除は
  tombstone（`deleted: true`）で伝播する。データモデルはこのために `id` /
  `updatedAt` / `deleted` を最初から持たせてある
- オフラインの編集は IndexedDB に溜め、オンラインになったら（`online` イベント、
  `visibilitychange`、保存直後）同期する。同期中もアプリは IndexedDB を見て動く
- ファイルは 1MB 未満に保つ（Contents API の実用上限）。予定 1 件 ≒ 300 バイトなので
  3,000 件まで余裕。超えたら年ごとにファイルを分ける
- レート制限は 5,000 req/時/トークン。家族が普通に使う量では届かない
- 5 分に 1 回程度のポーリングで他の端末の変更を拾う。「即時」に見せたいなら
  段階 3 では諦める（Push を使えば段階 4 で通知できる）

**段階 4 との組み合わせ。** GitHub Actions の `schedule`（最短 5 分間隔、遅れることが
ある）で `events.json` と `subscriptions.json` を読み、期限が来たリマインダーを
`web-push` で送る。VAPID の秘密鍵は Actions の secret に置く。時刻の精度は
「数分ずれてもよい通知」（当日朝のまとめ、30 分前）に向く。分単位で正確に
鳴らしたいなら Cloudflare Workers の cron の方が向く。

**知っておくこと。**

- git の履歴に全変更が残る。消した予定も履歴には残る（非公開なので家族以外は
  見えないが、消えはしない）
- GitHub が落ちている間は同期できない。アプリ自体は端末内で動き続ける
- 家族が GitHub アカウントを持つ必要はない。トークンはすべて所有者のもの

## 未決・保留

- ホスティング。GitHub Pages（このリポジトリを公開にする。無料プランは公開リポジトリのみ）か Cloudflare Pages か。オリジンは家族へ配る前に確定する（後から動かせない）
- アイコン（`apple-touch-icon` 180px と manifest 用 192/512px）
- 祝日表示を入れるか（入れるなら祝日データを precache に含める。外部 API は使わない）

## 参考にしたもの

| 参照先 | 取り入れる点 | 取り入れない点 |
|---|---|---|
| [PWAs: Personal Web Apps](https://ma.ttias.be/pwas-personal-web-apps/) と [offline-first-pwa](https://github.com/mattiasgeniar/offline-first-pwa) | 設計の全体（cache-first、precache、更新バナー、iOS の癖、テスト方法）。`.claude/skills/offline-first-pwa/` に vendoring | — |
| [scottgriv/PWA-Demo-App](https://github.com/scottgriv/PWA-Demo-App) | GitHub Pages への配信（`actions/configure-pages` → `upload-pages-artifact` → `deploy-pages` の Actions 構成、リポジトリ名がパスに付くときの `start_url` / worker 登録パスの扱い）。アイコン一式の生成に pwa-asset-generator。段階 4 の Web Push（VAPID 鍵の作り方） | React + CRA + Workbox のスタック（バンドラなしの方針と合わない）。CDN の FontAwesome と第三者ウィジェット（本人も「満点を取るなら外せ」と書いている）。Node + PostgreSQL の同期サーバ（段階 3 で別途決める）。Lighthouse の満点は目標にしない（遅い回線での起動時間を測る方が目的に合う） |
