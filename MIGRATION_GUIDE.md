# データベースマイグレーションガイド

## 概要
このガイドでは、データベースに新しいカラムや変更を追加する方法を説明します。

---

## マイグレーション 002: room_name カラム追加

### 目的
恵比寿店・半蔵門店のカレンダー同期で「個室A」「個室B」を正確に表示するため、`reservations` テーブルに `room_name` カラムを追加します。

### 実行方法

#### **方法1: Google Apps Scriptから実行（おすすめ）**

1. **Google Apps Scriptエディタを開く**
   - Gmail にログイン
   - Apps Script プロジェクトを開く

2. **新しいスクリプトファイルを作成**
   - ファイル名: `run-migration.gs`
   - 内容: `run-migration-gas.js` の内容をコピー

3. **実行**
   ```javascript
   runMigration()
   ```

4. **確認**
   ログに「✅ マイグレーション成功！」と表示されればOK

---

#### **方法2: curlコマンドで実行**

ターミナルで以下を実行：

```bash
curl -X POST https://hallel-shibuya.vercel.app/api/admin/run-migration \
  -H "Content-Type: application/json" \
  -H "X-API-Key: Wh00k@2025!Secure$Token#ABC123XYZ" \
  -d '{"migration": "002_add_room_name"}'
```

成功すると：
```json
{
  "status": "success",
  "message": "マイグレーション完了：room_nameカラムを追加しました",
  "migration_name": "002_add_room_name"
}
```

---

#### **方法3: Postmanで実行**

1. **リクエスト設定**
   - Method: `POST`
   - URL: `https://hallel-shibuya.vercel.app/api/admin/run-migration`

2. **Headers**
   ```
   Content-Type: application/json
   X-API-Key: Wh00k@2025!Secure$Token#ABC123XYZ
   ```

3. **Body (JSON)**
   ```json
   {
     "migration": "002_add_room_name"
   }
   ```

4. **Send をクリック**

---

## マイグレーション後のステップ

### 1. 予約データを再送信して room_name を取り込む

Google Apps Scriptで実行：
```javascript
processLatestReservationsOnly()
```

これで、すべての予約にメール本文から抽出した `room_name` が設定されます。

### 2. 恵比寿カレンダーを同期

Google Apps Scriptで実行：
```javascript
syncEbisuCalendar()
```

これで、Googleカレンダーに正しい部屋名が表示されます。

---

## マイグレーション一覧

| マイグレーション名 | 説明 | 実行日 |
|------------------|------|--------|
| 001_add_security_tables | セキュリティテーブル追加 | - |
| 002_add_room_name | room_nameカラム追加 | 2025-xx-xx |

---

## トラブルシューティング

### エラー: "Unauthorized"
- X-API-Key が正しいか確認
- `Wh00k@2025!Secure$Token#ABC123XYZ` を使用

### エラー: "column already exists"
- すでにマイグレーション済み
- 問題なし（安全に再実行可能）

### エラー: "Internal server error"
- Vercel ログを確認
- データベース接続を確認

---

## 今後のマイグレーション作成方法

### 1. SQLファイルを作成
`migrations/003_example.sql` を作成

### 2. app.py にマイグレーション処理を追加
`run_migration()` 関数に新しい条件分岐を追加

### 3. GASスクリプトを更新
`run-migration-gas.js` の migration 名を変更

### 4. 実行
上記の方法で実行

---

## セキュリティ注意事項

- API Key は絶対に公開しない
- マイグレーションは本番環境で慎重に実行
- 必ず事前にバックアップを取る
