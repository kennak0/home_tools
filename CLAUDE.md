# test_js リポジトリ作業ガイド

## プロジェクト概要
このリポジトリは個人使用のUserScriptを実装・管理するためのものです。

## セキュリティ要件
- **外部へのデータ送信は厳禁**
- ユーザーの許可なくデータを外部サービスに送信しない
- APIキーや認証情報をコードに直接記載しない
- すべてのネットワークリクエストは必要最小限に留める

## 開発規約

### 言語とツール
- 主要言語: JavaScript (UserScript形式)
- UserScriptメタデータブロックを必ず含める
- ESLintやPrettierの設定がある場合は従う

### コーディング規約
1. **変数名・関数名**: わかりやすい英語名を使用
2. **インデント**: スペース2つまたは4つ（既存コードに合わせる）
3. **セミコロン**: 既存コードのスタイルに従う
4. **コメント**: 複雑なロジックには日本語でコメントを追加可能

## コミュニケーション方針
- 日本語でのコミュニケーションを基本とする
- 簡潔で明確な説明を心がける
- 気遣い的なやりとりは不要、トークンの無駄遣いを避ける
- 技術的な内容に集中し、効率的にコミュニケーションを行う

### UserScriptの構造
```javascript
// ==UserScript==
// @name         スクリプト名
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  スクリプトの説明
// @author       作者名
// @match        対象URL
// @grant        必要な権限
// ==/UserScript==

(function() {
    'use strict';
    // コード本体
})();
```

### テスト方法
1. ブラウザの拡張機能（Tampermonkey/Greasemonkey）でテスト
2. コンソールログでデバッグ
3. エラーハンドリングを適切に実装

### ファイル命名規則
- UserScriptファイル: `機能名_説明.js`
- 日本語ファイル名も可（既存のパターンに従う）

### よく使用するパターン
- DOM操作: `querySelector`, `querySelectorAll`
- 非同期処理: `async/await`または`Promise`
- イベントリスナー: `addEventListener`
- スタイル注入: `GM_addStyle`または直接DOM操作

### 注意事項
- ページのロード完了を待つ（`DOMContentLoaded`または`load`イベント）
- 既存のページ機能を壊さないよう注意
- パフォーマンスを考慮（過度なDOM操作を避ける）
- エラーが発生してもページの動作を妨げない

## 作業時のチェックリスト
- [ ] UserScriptメタデータが正しく設定されているか
- [ ] 外部通信を行う場合は必要最小限か
- [ ] エラーハンドリングが適切か
- [ ] 既存のコードスタイルに従っているか
- [ ] コンソールにデバッグ用のログを残していないか（本番環境）

## リポジトリ内の既存スクリプト例
- Feedly向けはてなブックマーク数表示
- Kagi検索結果への各種メトリクス表示（はてブ、HN、Bluesky）
- Tumblr投稿スクリプト（OAuth2対応）

## Tumblr API OAuth2 認証について

### 概要
Tumblr APIは現在OAuth 1.0aとOAuth 2.0の両方をサポートしています。OAuth 2.0が推奨されています。

### OAuth 2.0 認証フロー

#### 1. アプリケーション登録
- [Tumblr Apps](https://www.tumblr.com/oauth/apps)でアプリケーションを登録
- OAuth Consumer KeyとConsumer Secretを取得
- 有効なOAuth2リダイレクトURLの設定が必要

#### 2. 認証エンドポイント
```
Authorization URL: https://www.tumblr.com/oauth2/authorize
Access Token URL: https://api.tumblr.com/v2/oauth2/token
```

#### 3. 認証フロー
1. **認証URLにリダイレクト**
   - ユーザーをTumblrの認証ページに誘導
   - `state`パラメータで状態を管理

2. **認証コード取得**
   - 認証成功時、リダイレクトURLに`code`と`state`が付与
   - `state`値の検証が必要

3. **アクセストークン取得**
   ```bash
   curl -F grant_type=authorization_code \
        -F code={code} \
        -F client_id={OAuth Consumer Key} \
        -F client_secret={OAuth Consumer Secret} \
        https://api.tumblr.com/v2/oauth2/token
   ```

#### 4. API利用
- Bearer tokenを使用してAPI呼び出し
- Authorization: Bearer {access_token}

### 投稿API
```
POST https://api.tumblr.com/v2/blog/{blog-identifier}/posts
```

### 注意点
- OAuth 1.0aからOAuth 2.0への移行時は、元のアクセストークンが無効化される
- クライアントサイドフローは推奨されない
- PKCEサポートは今後予定

### 参考リンク
- [Tumblr API v2 公式ドキュメント](https://www.tumblr.com/docs/en/api/v2)
- [OAuth 2.0 エンジニアリングブログ](https://engineering.tumblr.com/post/666127838922014720/oauth-2-on-the-tumblr-api)

## Feedly UserScript開発で発生した問題と解決策

### 問題: DOM操作による要素追加が表示されない

**発生した問題**:
- DOM操作でバッジ要素を追加してもサイズが0x0になって表示されない
- HTMLは正しく生成されているがFeedlyの画面に表示されない
- Feedlyが仮想DOM（ReactやVue等）を使用している可能性が高い

**試行した解決策**:
1. **z-indexの調整** - 効果なし
2. **CSSスタイルの強制適用** - 効果なし
3. **異なる挿入位置の試行** - 効果なし
4. **position: absoluteの使用** - 効果なし
5. **DOM要素の直接操作** - 仮想DOMによって上書きされる

**有効な解決策**:
- **CSS擬似要素（::before/::after）の使用**
- data属性にスコア情報を保存
- CSS content: attr()で表示
- 仮想DOMの影響を受けない

**実装例**:
```javascript
// データ属性に保存
linkElement.setAttribute('data-score-text', '[B:100 HN:50]');
linkElement.setAttribute('data-score-loaded', 'true');

// CSSで表示
const css = `
    a[data-score-loaded="true"]::before {
        content: attr(data-score-text) !important;
        margin-right: 8px !important;
    }
`;
```

### 教訓
- Feedlyのような現代的なWebアプリケーションでは仮想DOMが使用される可能性が高い
- 直接的なDOM操作は仮想DOMによって上書きされる
- CSS擬似要素とdata属性の組み合わせが最も確実な方法
- 初期調査でページの技術スタックを把握することが重要

### Feedly UserScript開発での注意点
- DOM操作による要素追加は表示されない（仮想DOM使用のため）
- CSS擬似要素とdata属性の組み合わせを使用する
- 直接的なDOM操作は避ける