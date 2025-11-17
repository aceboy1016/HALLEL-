# HALLEL 渋谷店 予約管理システム

HALLEL渋谷店の予約状況を管理・表示するWebアプリケーションです。

## 📋 機能

### 🌐 公開ページ
- リアルタイムの予約状況確認
- 30分単位のタイムスロット表示
- カレンダーで日付切り替え
- ダークテーマのスタイリッシュなデザイン
- レスポンシブ対応（スマホ・PC）

### 🔐 管理者機能
- 管理者ログイン認証
- 予約の手動追加・削除
- 貸切予約の管理
- アクティビティログの閲覧
- パスワード変更機能

### 📧 Gmail自動連携
- Gmailから予約メールを自動検知
- 予約・キャンセルの自動反映
- **メール数過多対策実装済み**
  - 日付・キーワードフィルタリング
  - 処理件数制限
  - ラベル使用を最小化

## 🚀 クイックスタート

### 1. 必要なソフトウェア

- Python 3.8以上
- pip

### 2. インストール

```bash
# リポジトリのクローン
git clone https://github.com/yourusername/HALLEL-.git
cd HALLEL-

# 依存パッケージのインストール
pip install -r requirements.txt
```

### 3. アプリケーションの起動

```bash
python app.py
```

アプリケーションは http://localhost:5001 で起動します。

### 4. 初期ログイン

- URL: http://localhost:5001/login
- 初期パスワード: `hallel0000admin`

**重要: 初回ログイン後、必ずパスワードを変更してください！**

## 📁 ファイル構成

```
HALLEL-/
├── app.py                      # メインアプリケーション
├── requirements.txt            # Python依存パッケージ
├── password.txt                # 管理者パスワード（ハッシュ化）
├── activity.log                # アクティビティログ
│
├── templates/                  # HTMLテンプレート
│   ├── booking-status.html     # 公開予約状況ページ
│   ├── admin.html              # 管理ダッシュボード
│   ├── admin-calendar.html     # カレンダー管理
│   └── login.html              # ログインページ
│
├── gmail_booking_sync.py       # Gmail連携スクリプト（Python版）
├── google-apps-script.js       # Gmail連携スクリプト（GAS版）
├── get_gmail_token.py          # Gmail認証トークン取得
│
├── config.example.py           # 設定ファイルの例
├── README.md                   # このファイル
└── GMAIL_SETUP.md              # Gmail連携セットアップガイド
```

## 📧 Gmail連携のセットアップ

Gmail連携を使用すると、予約メールを自動的に検知してシステムに反映できます。

詳しいセットアップ方法は **[GMAIL_SETUP.md](GMAIL_SETUP.md)** を参照してください。

### メール数過多問題について

Gmail APIでは、大量のメールにラベルを付けようとするとAPIの制限に引っかかります。
本システムでは以下の対策を実装しています：

- ✅ 過去7日間のメールのみ対象
- ✅ 未読メールのみ処理
- ✅ 件名キーワードでフィルタリング
- ✅ 一度に最大50件まで処理
- ✅ ラベル不使用（既読マークのみ）

詳細は [GMAIL_SETUP.md](GMAIL_SETUP.md) の「メール数過多対策について」を参照。

## 🎨 画面説明

### 公開ページ（/）
一般客が予約状況を確認できるページです。

- **緑**: 空いています（0-40%）
- **黄**: やや混雑（40-70%）
- **赤**: 混雑（70%以上）
- **グレー**: 貸切

### 管理者ページ（/admin）
ログイン後にアクセスできる管理画面です。

- アクティビティログの閲覧
- パスワード変更
- カレンダー管理へのリンク

### カレンダー管理（/admin/calendar）
予約の追加・削除を行えます。

- タイムスロットをクリックして予約追加
- 既存予約の削除
- 貸切予約の設定

## 🔧 設定

### 最大収容人数の変更

`app.py` と各HTMLファイルの `MAX_CAPACITY` を変更してください。

```python
# app.py (該当なし、HTMLファイルで設定)
```

```javascript
// templates/booking-status.html
// templates/admin-calendar.html
const MAX_CAPACITY = 7;  // ここを変更
```

### パスワードの変更

管理者画面（/admin）からパスワードを変更できます。

または、初期パスワードを変更したい場合は：

1. `password.txt` を削除
2. `app.py` の `set_initial_password()` 関数内のパスワードを変更
3. アプリケーションを再起動

## 📡 API エンドポイント

### GET /api/reservations
すべての予約データを取得します。

**レスポンス例:**
```json
{
  "2025-08-01": [
    { "type": "gmail", "start": "14:00", "end": "15:00" },
    { "type": "charter", "start": "11:00", "end": "13:00" }
  ]
}
```

### POST /api/reservations
予約を追加します（管理者のみ）。

**リクエスト例:**
```json
{
  "date": "2025-08-01",
  "type": "manual",
  "start": "16:00",
  "end": "17:00"
}
```

### POST /api/reservations/delete
予約を削除します（管理者のみ）。

**リクエスト例:**
```json
{
  "date": "2025-08-01",
  "index": 0
}
```

### POST /api/process_email
Gmail連携用のエンドポイントです（外部スクリプトから呼び出し）。

**予約の追加:**
```json
{
  "action_type": "booking",
  "date": "2025-08-05",
  "start_time": "14:00",
  "end_time": "15:30"
}
```

**予約のキャンセル:**
```json
{
  "action_type": "cancellation",
  "date": "2025-08-05",
  "start_time": "14:00"
}
```

## 🗃️ データの永続化

現在、予約データはメモリ上に保存されているため、サーバーを再起動するとデータが消えます。

### 本番環境での推奨事項

1. **データベースの導入**
   - SQLite（小規模）
   - PostgreSQL（中〜大規模）

2. **バックアップ機能の追加**
   - 定期的なデータのJSONエクスポート
   - データベースのバックアップ

3. **本番用サーバーの使用**
   - Gunicorn + Nginx
   - または、PaaSサービス（Heroku、Railway等）

## 🛡️ セキュリティ

### セキュリティ強化状況（フェーズ1実装済み）

✅ **実装済み:**
- データベースベースの認証システム
- ブルートフォース攻撃対策（5回失敗で15分ロック）
- アクティビティログ（IP・User-Agent記録）
- パスワードハッシュ化（pbkdf2:sha256）
- セッション管理の改善
- 環境変数によるSECRET_KEY管理

⚠️ **実装予定（700名展開前）:**
- CSRF保護
- セキュリティヘッダー
- プライバシーポリシー・利用規約
- Cookie同意取得
- レート制限（DoS対策）

詳細は **[SECURITY_LEGAL_AUDIT_REPORT.md](SECURITY_LEGAL_AUDIT_REPORT.md)** を参照してください。

### 本番環境での注意点

1. **SECRET_KEYの設定**
   - 環境変数 `SECRET_KEY` に固定値を設定
   - Vercelの環境変数で設定済み

2. **HTTPS の使用**
   - SSL証明書の設定
   - Vercel/Netlify等では自動設定

3. **パスワードポリシー**
   - 最低8文字以上（実装済み）
   - 定期的な変更を推奨

4. **認証情報の管理**
   - credentials.json と token.json をGitにコミットしない
   - .gitignore に追加済み

## 📋 将来の機能拡張

以下の機能は今後の実装を予定しています：

### 認証・セキュリティ
- [ ] **複数管理者アカウント対応** - ログインユーザーの完全な区別（誰がログインしたか識別）
- [ ] 多要素認証（MFA）
- [ ] 管理者の権限レベル設定（閲覧のみ、編集可能など）
- [ ] ログイン履歴の詳細表示

### 機能拡張
- [ ] 予約のメール通知
- [ ] 顧客データベース（顧客情報の蓄積）
- [ ] レポート機能（月次利用統計など）
- [ ] API認証トークン（外部システム連携用）

### インフラ
- [ ] データベース暗号化
- [ ] リアルタイムモニタリング
- [ ] 自動バックアップ

## 🐛 トラブルシューティング

### アプリが起動しない

**原因:** ポート5001が使用中

```bash
# 別のポートで起動
python app.py
# app.py内のポート番号を変更
```

### ログインできない

1. `password.txt` を削除
2. アプリケーションを再起動
3. 初期パスワード `hallel0000admin` でログイン

### Gmail連携がうまく動かない

[GMAIL_SETUP.md](GMAIL_SETUP.md) の「トラブルシューティング」を参照してください。

## 📝 ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## 🤝 コントリビューション

バグ報告や機能追加の提案は、GitHubのIssueからお願いします。

## 📞 サポート

質問や問題がある場合は、以下の方法でお問い合わせください：

- GitHub Issues
- Email: support@hallel.example.com

---

**HALLEL 渋谷店 予約管理システム**
Made with ❤️ for HALLEL
