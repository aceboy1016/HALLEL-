# Googleカレンダー同期の仕組み

## 📋 概要

HALLEL恵比寿店・半蔵門店の予約をGoogleカレンダーに自動同期します。

---

## 🏗️ システム構成

### **現在の構成（推奨）**

```
ebisu@topform.jp → Gmail → GAS
                           ↓
                    1. Vercel API → PostgreSQL（予約データ保存）
                    2. Googleカレンダー（直接書き込み）
```

### **メリット**
- ✅ **OAuth認証不要**（GASが自動処理）
- ✅ **GOOGLE_SERVICE_ACCOUNT_JSON不要**
- ✅ **過去3500件のメールにアクセス可能**
- ✅ **完璧に動作中**
- ✅ **シンプル＆確実**

---

## 📂 ファイル構成

### **GAS側（ebisu@topform.jp）**
- `hallel-ebisu-calendar.gs` - カレンダー同期メイン処理
  - 予約完了メール → カレンダーに追加
  - キャンセルメール → カレンダーから削除
  - STUDIO A/B → 個室A/個室B に変換

### **Vercel側（データベース管理）**
- `app.py` - Vercel APIエンドポイント
  - `/webhook/gas` - GASからの予約データ受信
  - `/api/sync-ebisu-calendar` - **廃止**（GAS側で実行）
- `calendar_sync.py` - **使用していない**（GAS側で実行）

---

## 🚀 運用方法

### **1. 自動実行（推奨）**

GASトリガーで30分ごとに自動実行されます。

```javascript
// GASエディタで実行（1回のみ）
setupEbisuTrigger()
```

### **2. 手動実行**

必要に応じて手動で実行できます。

```javascript
// GASエディタで実行
manageHallelReservations()
```

### **3. 全メール再処理**

過去の全メールを再処理してカレンダーに反映します。

```javascript
// GASエディタで実行
reprocessAllWithoutCalendarReset()
```

---

## 📊 カレンダーイベント形式

### **イベントタイトル**
```
{顧客名} - HALLEL-{部屋名}
```

### **例**
```
二宮 遼太朗 - HALLEL-個室A
川田 直宏 - HALLEL-個室B
TOPFORM 高橋 広明 - HALLEL-個室A
```

### **部屋名の抽出ルール**
| メール本文 | カレンダー表示 |
|-----------|--------------|
| STUDIO A  | 個室A        |
| STUDIO B  | 個室B        |
| 不明      | Unknown      |

---

## 🔧 トラブルシューティング

### **カレンダーに予約が表示されない**

**原因1: GASトリガーが動作していない**
```javascript
// GASエディタで確認
checkLabelStatus()  // ラベル状況を確認
checkEbisuReservations()  // カレンダーの予約を確認
```

**原因2: メールが処理済みとしてスキップされている**
```javascript
// GASエディタで実行（処理済みラベルを外す）
removeAllProcessedLabels()
clearProcessedMessagesRecord()

// 全メール再処理
manageHallelReservations()
```

### **重複したイベントが表示される**

**解決方法: 全メール再処理**
```javascript
// GASエディタで実行
reprocessAllWithoutCalendarReset()
```

改善版スクリプトが重複を自動的に削除します。

### **カレンダーをリセットしたい**

**注意: この操作は元に戻せません！**

```javascript
// GASエディタで実行
resetAndReprocessAll()
```

1. カレンダーの全HALLEL予約を削除
2. 処理済みラベルを外す
3. 処理済み記録をクリア
4. 全メール再処理

---

## 📝 メンテナンス

### **定期クリーンアップ（月1回推奨）**

```javascript
// GASエディタで実行
cleanupProcessedMessages()  // 30日以上前の記録を削除
```

### **ラベル管理**

GASが自動的に以下のラベルを使用します：

- `HALLEL_Ebisu/Processed` - 処理済みメール
- `HALLEL_Ebisu/Error` - エラーメール

---

## 🆘 サポート

### **ログの確認**

GASエディタの「実行ログ」でエラー内容を確認できます。

### **テスト実行**

```javascript
// GASエディタで実行（最新5件のみ処理）
testEbisuSync()
```

---

## 📚 参考情報

### **GASスクリプト**
- ファイル: `hallel-ebisu-calendar.gs`
- カレンダーID: `ebisu@topform.jp`
- 実行頻度: 30分ごと（自動）

### **Vercelエンドポイント**
- `/webhook/gas` - 予約データ受信（使用中）
- `/api/sync-ebisu-calendar` - カレンダー同期（廃止）

---

## ✅ 動作確認済み

- ✅ 予約完了メール → カレンダーに追加
- ✅ キャンセルメール → カレンダーから削除
- ✅ STUDIO A/B → 個室A/個室B 変換
- ✅ 重複予約の自動削除
- ✅ 過去3500件のメール処理

---

最終更新: 2025年11月20日
