# HALLEL全店舗 GAS予約管理システム - 引き継ぎドキュメント

## 📋 プロジェクト概要
HALLEL全5店舗（半蔵門・渋谷・恵比寿・中目黒・代々木上原）のGmail予約メールを自動処理し、Vercel APIに送信するシステム。各店舗で独立したGoogleアカウントとGASプロジェクトを使用。

## 🏢 店舗構成

| 店舗名 | Gmailアカウント | GASコード | ラベル名 | カレンダー同期 |
| :--- | :--- | :--- | :--- | :--- |
| 半蔵門 | hallel-hanzomon@gmail.com | `/gas-scripts/hanzomon/main.js` | `HALLEL_処理済み_半蔵門` | あり (light@topform.jp) |
| 渋谷 | hallel-shibuya@gmail.com | `/gas-scripts/shibuya/main.js` | `HALLEL_処理済み_渋谷` | なし |
| 恵比寿 | hallel-ebisu@gmail.com | `/gas-scripts/ebisu/main.js` | `HALLEL_処理済み_恵比寿` | あり (ebisu@topform.jp) |
| 中目黒 | hallel-nakameguro@gmail.com | `/gas-scripts/nakameguro/main.js` | `HALLEL_処理済み_中目黒` | なし |
| 代々木上原 | hallel-yoyogiuehara@gmail.com | `/gas-scripts/yoyogiuehara/main.js` | `HALLEL_処理済み_代々木上原` | なし |

## ✨ 実装機能

### 1. Gmailラベル方式による重複防止
- 処理済みメールに自動でラベルを付与
- 未処理メールのみを取得・処理
- API送信成功時のみラベル追加（失敗時は次回リトライ）

### 2. 超厳密な店舗判定（3段階）
```javascript
// 第1段階：検索クエリ
SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel'

// 第2段階：店舗キーワード必須
const isThisStore = body.includes('店舗： HALLEL 半蔵門店') ||
                   body.includes('店舗：HALLEL 半蔵門店') ||
                   body.includes('設備： 半蔵門店') ||
                   body.includes('設備：半蔵門店');

// 第3段階：他店舗除外
EXCLUDE_KEYWORDS: ['渋谷店', '恵比寿店', '中目黒店', '代々木上原店']
```

### 3. API送信
- エンドポイント：`https://hallel-shibuya.vercel.app/api/gas/webhook`
- 認証：`X-API-Key: Wh00k@2025!Secure$Token#ABC123XYZ`
- データ形式：JSON

### 4. Google Calendar同期（一部店舗のみ）
- 予約：カレンダーに追加
- キャンセル：カレンダーから削除
- 重複チェックあり

### 5. ラベル一括削除機能
- 全店舗の誤ったラベルをリセット可能
- 関数：`removeAllProcessedLabels()`

## 🚀 セットアップ手順（新規店舗または再設定）

### ステップ0：事前準備（初回のみ）
#### 0-1. 古いラベルの削除（既存店舗の場合）
1. どれか1つの店舗のGASで実行（全店舗のラベルが削除される）：
2. 関数を選択: `removeAllProcessedLabels`
3. 実行ボタンをクリック

### ステップ1：GASプロジェクトにアクセス
1. 対象店舗のGmailアカウントでログイン
2. Google Apps Script（script.google.com）にアクセス
3. 既存プロジェクトを開く、または新規作成

### ステップ2：コードをコピペ
1. 左側のファイルリストで `コード.gs` を開く
2. 既存コードを全て削除
3. 対応する店舗のコードをコピー：
    - 半蔵門店 → `/gas-scripts/hanzomon/main.js`
    - 渋谷店 → `/gas-scripts/shibuya/main.js`
    - 恵比寿店 → `/gas-scripts/ebisu/main.js`
    - 中目黒店 → `/gas-scripts/nakameguro/main.js`
    - 代々木上原店 → `/gas-scripts/yoyogiuehara/main.js`
4. 貼り付けて保存（Ctrl+S / Cmd+S）

### ステップ3：権限の承認
1. 関数を選択：`setupTrigger10min`
2. 実行ボタンをクリック
3. 権限エラーが出る場合：
    - エディタ上部の「権限を確認」をクリック
    - Googleアカウントを選択
    - 「詳細」→「（安全ではないページ）に移動」をクリック
    - 「許可」をクリック
4. 再度 `setupTrigger10min` を実行

### ステップ4：動作確認
1. 関数を選択：`processNewReservations`
2. 実行ボタンをクリック
3. ログを確認（下部の「実行ログ」タブ）：
```text
【恵比寿店：処理開始】
未処理スレッド: X件
予約: 田中太郎 (個室A)
API送信成功: 1件
ラベル追加: 1スレッド
【処理完了】
```

### ステップ5：Gmailで確認
1. Gmailを開く
2. 左側のラベルに `HALLEL_処理済み_{店舗名}` が作成されている
3. 処理済みメールにラベルが付いている

## 📝 主要関数一覧

### 自動実行関数
| 関数名 | 説明 | 実行タイミング |
| :--- | :--- | :--- |
| `processNewReservations` | 未処理メールを処理してAPI送信 | 10分ごと（自動） |

### セットアップ関数
| 関数名 | 説明 | 実行タイミング |
| :--- | :--- | :--- |
| `setupTrigger10min` | 10分ごとのトリガーを設定 | 初回セットアップ時 |
| `setupTrigger1hour` | 1時間ごとのトリガーを設定（オプション） | 必要に応じて |
| `deleteAllTriggers` | 全トリガーを削除 | トリガーリセット時 |
| `listTriggers` | 現在のトリガー一覧を表示 | 確認時 |

### メンテナンス関数
| 関数名 | 説明 | 実行タイミング |
| :--- | :--- | :--- |
| `removeAllProcessedLabels` | 全店舗の処理済みラベルを削除 | ラベルリセット時 |
| `syncAllToAPI` | 過去の全メールをAPI同期 | 初回データ移行時 |

### テスト・確認関数
| 関数名 | 説明 | 実行タイミング |
| :--- | :--- | :--- |
| `testExtractStudio` | 部屋名抽出ロジックのテスト | 動作確認時 |
| `checkCalendarStatus` | カレンダー同期状況を確認（半蔵門・恵比寿のみ） | 動作確認時 |

## 🔧 CONFIG設定（店舗固有）
各店舗の設定は `CONFIG` オブジェクトで管理：

```javascript
const CONFIG = {
  STORE_NAME: 'hanzomon',                    // APIに送信する店舗識別子
  STORE_KEYWORD: '半蔵門',                   // ログ表示用
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel',  // Gmail検索クエリ
  INCLUDE_KEYWORD: '半蔵門店',               // 必須キーワード
  EXCLUDE_KEYWORDS: ['渋谷店', '恵比寿店', '中目黒店', '代々木上原店'],  // 除外キーワード
  DEFAULT_ROOM: '個室B',                     // デフォルト部屋名
  API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',  // API URL
  API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',  // API認証キー
  CALENDAR_ID: 'light@topform.jp',          // カレンダーID（nullなら同期なし）
  LABEL_NAME: 'HALLEL_処理済み_半蔵門',     // Gmailラベル名
};
```

## 🏪 店舗別の特徴

### 半蔵門店
- 部屋名：STUDIO B ①②③、個室A/B
- カレンダー：あり（light@topform.jp）
- 特殊処理：STUDIO A/B → 個室A/B変換

### 渋谷店
- 部屋名：STUDIO ①~⑦
- カレンダー：なし

### 恵比寿店
- 部屋名：個室A/B（元々STUDIO A/B）
- カレンダー：あり（ebisu@topform.jp）
- 特殊処理：STUDIO A/B → 個室A/B変換

### 中目黒店
- 部屋名：フリーウエイトエリア、格闘技エリア
- カレンダー：なし

### 代々木上原店
- 部屋名：パーソナルジム（区別なし）
- カレンダー：なし

## ⚠️ トラブルシューティング

### 問題1：権限エラー
`Exception: Specified permissions are not sufficient`

**解決策：**
1. GASエディタ上部の「権限を確認」をクリック
2. Googleアカウントで承認
3. 再度関数を実行

### 問題2：他店舗のメールが処理される
**原因：** 古いコードまたは設定ミス
**解決策：**
1. 最新のコードをコピペし直す
2. `CONFIG.INCLUDE_KEYWORD` と `CONFIG.EXCLUDE_KEYWORDS` を確認
3. `removeAllProcessedLabels()` で古いラベルを削除
4. `processNewReservations()` で再処理

### 問題3：カレンダー同期エラー
`カレンダー未設定: light@topform.jp`

**解決策：**
1. Google Calendarで対象カレンダーを開く
2. 「設定と共有」から、店舗のGmailアカウントを編集権限で共有
3. 再度 `processNewReservations()` を実行

### 問題4：ラベルが重複している
**解決策：**
1. どれか1つの店舗で `removeAllProcessedLabels()` を実行
2. 全店舗で `processNewReservations()` を実行
3. 正しいラベルが付く

## 📊 ログの見方

### 正常な実行ログ
```text
============================================================
【恵比寿店：処理開始】2025/11/26 21:30:00
未処理スレッド: 3件
予約: 田中太郎 (個室A)
予約: 佐藤花子 (個室B) 【貸切】
キャンセル: 山田次郎 (個室A)
送信対象: 3件
API送信成功: 3件
ラベル追加: 3スレッド
カレンダー: 追加2件, 削除1件
【処理完了】
```

### エラーログ
`API送信失敗: HTTP 500`
→ APIサーバーの問題。ラベルは付かないため、次回リトライされる

## 🔄 定期メンテナンス
### 月次チェック
1. GAS「実行数」タブで実行履歴を確認
2. エラーが多い場合は原因調査
3. Gmail容量を確認（ラベル付きメールがたまる）

### ラベル整理
- 必要に応じて古い処理済みメールのラベルを外す（Gmail上で手動）

## 📞 サポート情報

### API エンドポイント
`POST https://hallel-shibuya.vercel.app/api/gas/webhook`
Header: `X-API-Key: Wh00k@2025!Secure$Token#ABC123XYZ`

### データ形式
```json
{
  "source": "gas",
  "timestamp": "2025-11-26T12:00:00.000Z",
  "reservations": [{
    "date": "2025-12-01",
    "start": "10:00",
    "end": "11:00",
    "customer_name": "田中太郎",
    "room_name": "個室A",
    "store": "ebisu",
    "type": "gmail",
    "is_cancellation": false,
    "is_charter": false,
    "source": "gas_sync",
    "email_id": "...",
    "email_date": "2025-11-26T12:00:00.000Z"
  }]
}
```

## 📌 重要な注意事項
- 各店舗は独立：他店舗の設定変更は影響しない
- ラベルは店舗ごと：`HALLEL_処理済み_{店舗名}` で明確に区別
- API送信成功後にラベル：失敗時はラベルなし = 次回リトライ
- トリガーは10分ごと：変更する場合は `setupTrigger1hour()` を使用
- カレンダー共有必須：半蔵門・恵比寿は事前に共有設定が必要
