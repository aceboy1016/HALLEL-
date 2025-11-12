# HALLEL 渋谷店 予約管理システム

HALLEL渋谷店の予約状況を管理・表示するWebアプリケーションです。

## 🌐 本番環境

**公開ページ（お客様向け）:**
https://hallel-shibuya.vercel.app/

**管理者ページ:**
https://hallel-shibuya.vercel.app/admin
パスワード: `hallel0000admin`

## 📋 機能

### 🌐 公開ページ
- リアルタイムの予約状況確認
- 30分単位のタイムスロット表示
- カレンダーで日付切り替え
- 混雑度を視覚的に表示：
  - **緑（空いてる）**: 0-2人
  - **黄（普通）**: 3-5人
  - **赤（混んでる）**: 6-7人
  - **グレー（貸切）**: 貸切予約
- ダークテーマのスタイリッシュなデザイン
- レスポンシブ対応（スマホ・PC）

### 🔐 管理者機能

**ダッシュボード（/admin）:**
- 日付別の予約一覧表示
- 顧客名・予約種別の確認（Gmail/手動/貸切）
- 予約の削除
- 重複データの一括削除
- アクティビティログの閲覧
- パスワード変更機能

**編集カレンダー（/admin/calendar）:**
- 時間軸に沿った予約の視覚的表示
- タイムスロットをクリックして予約追加
- 既存予約の削除
- 貸切予約の設定
- 日付ごとの予約件数表示

### 📧 Gmail自動連携（GAS Webhook）
- Gmailから予約メールを自動検知
- Google Apps Scriptから予約データをWebhookで送信
- 予約・キャンセルの自動反映
- email_idによる重複防止機能
- 同じメールの重複登録を自動検出・更新

## 🚀 技術スタック

- **バックエンド**: Flask (Python)
- **データベース**: PostgreSQL (Neon)
- **デプロイ**: Vercel (Serverless)
- **フロントエンド**: Bootstrap 5, flatpickr
- **Gmail連携**: Google Apps Script → Webhook

## 🗃️ データベース

本システムはPostgreSQL（Neon）を使用してデータを永続化しています。

### テーブル構成

**reservations テーブル:**
```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    store VARCHAR(50),
    date DATE,
    start_time TIME,
    end_time TIME,
    type VARCHAR(20),
    customer_name VARCHAR(255),
    email_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### データベース接続

環境変数 `DATABASE_URL` にNeonのPostgreSQL接続文字列を設定します。

```bash
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

## 📡 API エンドポイント

### GET /api/reservations
すべての予約データを日付別に取得します。

**レスポンス例:**
```json
{
  "2024-12-01": [
    {
      "type": "gmail",
      "start": "14:00",
      "end": "15:00",
      "customer_name": "山田太郎"
    },
    {
      "type": "charter",
      "start": "11:00",
      "end": "13:00",
      "customer_name": null
    }
  ]
}
```

### POST /api/reservations
予約を追加します（管理者のみ）。

**リクエスト例:**
```json
{
  "date": "2024-12-01",
  "type": "manual",
  "start": "16:00",
  "end": "17:00",
  "customer_name": "田中花子"
}
```

### POST /api/reservations/delete
予約を削除します（管理者のみ）。

**リクエスト例:**
```json
{
  "date": "2024-12-01",
  "start": "16:00",
  "end": "17:00",
  "customer_name": "田中花子"
}
```

### POST /api/gas/webhook
Google Apps ScriptからのWebhook受信エンドポイント。

**リクエスト例（予約）:**
```json
{
  "reservations": [
    {
      "store": "shibuya",
      "date": "2024-12-05",
      "start_time": "14:00",
      "end_time": "15:30",
      "customer_name": "佐藤一郎",
      "email_id": "abc123xyz",
      "is_cancellation": false
    }
  ]
}
```

**リクエスト例（キャンセル）:**
```json
{
  "reservations": [
    {
      "email_id": "abc123xyz",
      "is_cancellation": true,
      "store": "shibuya"
    }
  ]
}
```

### POST /api/admin/cleanup-duplicates
重複した予約データを削除します（管理者のみ）。

## 📁 ファイル構成

```
HALLEL-/
├── app.py                      # メインアプリケーション（Flask）
├── requirements.txt            # Python依存パッケージ
├── vercel.json                 # Vercelデプロイ設定
├── password.txt                # 管理者パスワード（ハッシュ化）
├── activity.log                # アクティビティログ
│
├── templates/                  # HTMLテンプレート
│   ├── booking-status.html     # 公開予約状況ページ
│   ├── admin.html              # 管理ダッシュボード
│   ├── admin-calendar.html     # カレンダー編集ページ
│   └── login.html              # ログインページ
│
└── README.md                   # このファイル
```

## 🛠️ ローカル開発

### 1. 必要なソフトウェア

- Python 3.9以上
- pip
- PostgreSQL（または、Neonアカウント）

### 2. インストール

```bash
# リポジトリのクローン
git clone https://github.com/aceboy1016/HALLEL-.git
cd HALLEL-

# 依存パッケージのインストール
pip install -r requirements.txt
```

### 3. 環境変数の設定

```bash
# .env ファイルを作成
echo "DATABASE_URL=postgresql://user:password@host/database?sslmode=require" > .env
```

### 4. アプリケーションの起動

```bash
python app.py
```

アプリケーションは http://localhost:5001 で起動します。

### 5. 初期ログイン

- URL: http://localhost:5001/admin
- パスワード: `hallel0000admin`

**重要: 本番環境では必ずパスワードを変更してください！**

## 📧 Gmail連携（Google Apps Script）

Gmail連携はGoogle Apps Script (GAS) を使用して実装されています。

### セットアップ手順

1. Google Apps Scriptプロジェクトを作成
2. 以下のトリガーを設定：
   - 関数: `processReservationEmails`
   - イベントソース: 時間主導型
   - 時間ベースのトリガー: 5分おき
3. スクリプトプロパティに以下を設定：
   - `WEBHOOK_URL`: `https://hallel-shibuya.vercel.app/api/gas/webhook`

### GASスクリプトの概要

GASスクリプトは以下の処理を実行します：

1. Gmailから予約メールを検索（過去7日間、未読のみ）
2. メール内容から予約情報を抽出（日付、時間、顧客名など）
3. Webhookエンドポイントにデータ送信
4. 処理済みメールを既読にする

## 🚀 デプロイ（Vercel）

本システムはVercelにデプロイされています。

### デプロイ方法

1. GitHubリポジトリをVercelに接続
2. 環境変数 `DATABASE_URL` を設定
3. mainブランチにプッシュすると自動デプロイ

### 環境変数

Vercelの環境変数設定で以下を追加：

```
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

## 🔧 設定

### 最大収容人数の変更

HTMLファイルの `MAX_CAPACITY` を変更してください。

```javascript
// templates/booking-status.html
// templates/admin-calendar.html
const MAX_CAPACITY = 7;  // ここを変更
```

### パスワードの変更

管理者画面（/admin）からパスワードを変更できます。

## 🛡️ セキュリティ

### 本番環境での注意点

1. **パスワードの変更**
   - 初期パスワード `hallel0000admin` を必ず変更

2. **HTTPS の使用**
   - Vercelは自動的にHTTPSを提供

3. **認証情報の管理**
   - データベース接続文字列を環境変数で管理
   - Gitにコミットしない

4. **セッション管理**
   - FlaskのセッションはSECRET_KEYで暗号化

## 🐛 トラブルシューティング

### ログインできない

1. `password.txt` を削除
2. アプリケーションを再起動
3. 初期パスワード `hallel0000admin` でログイン

### データベースに接続できない

1. 環境変数 `DATABASE_URL` が正しく設定されているか確認
2. Neonのデータベースが起動しているか確認
3. SSL接続が有効になっているか確認（`?sslmode=require`）

### Gmail連携がうまく動かない

1. GASスクリプトのトリガーが正しく設定されているか確認
2. Webhookエンドポイントが正しいか確認
3. GASの実行ログでエラーを確認

## 📅 運用スケジュール

- **11月中**: テスト運用（約1週間）
  - 実際の予約データで動作確認
  - 不具合があれば修正

- **12月1日～**: 本格運用開始

## 📝 ライセンス

このプロジェクトは内部使用のために開発されました。

---

**HALLEL 渋谷店 予約管理システム**
Made with ❤️ for HALLEL
