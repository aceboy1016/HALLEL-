# HALLEL恵比寿店 Google Calendar同期スクリプト

## 概要

GmailからHALLEL恵比寿店の予約完了・キャンセルメールを自動的に読み取り、Google Calendarに反映するGoogle Apps Scriptです。

## 主な改善点

### 1. キャンセル処理の精度向上
- **問題**: 完全一致でのみ検索していたため、マッチングに失敗しやすかった
- **改善**:
  - 検索範囲を±5分に拡大
  - 時間マッチングに±1分の許容範囲を設定
  - 名前とスタジオの柔軟なマッチング
  - キャンセル対象が見つからない場合も成功として扱う（既に削除済みの可能性を考慮）

### 2. 予約枠数制限（2枠まで）
- **問題**: 枠数制限がなく、3枠以上の予約が入ってしまった
- **改善**:
  - 同時間帯の予約数をカウント
  - 時間の重なりを正確に判定
  - 最大2枠を超える予約は警告ログを出してスキップ

### 3. 重複予約チェックの強化
- **問題**: 同じメールを複数回処理する可能性があった
- **改善**:
  - メッセージID単位で処理済み管理
  - PropertiesServiceで処理済みメッセージを記録
  - 30日以上前の記録を自動クリーンアップ

## セットアップ

### 1. Google Apps Scriptにコピー

1. [Google Apps Script](https://script.google.com/)を開く
2. 新しいプロジェクトを作成
3. `gas-ebisu-calendar-sync.js`の内容をコピー＆ペースト
4. プロジェクト名を「HALLEL恵比寿店カレンダー同期」などに変更

### 2. カレンダーID設定

スクリプト内の`CONFIG_EBISU.CALENDAR_ID`を確認：

```javascript
const CONFIG_EBISU = {
  CALENDAR_ID: 'ebisu@topform.jp',  // ← 必要に応じて変更
  // ...
};
```

### 3. Gmail APIの有効化（Advanced Gmail Service）

一部の機能でAdvanced Gmail Serviceを使用する場合：

1. GASエディタで「サービス」→「Gmail API」を追加
2. バージョン: v1

### 4. 初回テスト実行

```javascript
// GASエディタで「testEbisuSync」を選択して実行ボタン（▶️）をクリック
testEbisuSync();
```

- 初回は権限承認が必要です
- Googleアカウントでログインし、カレンダーとGmailへのアクセスを許可してください

## 使い方

### 手動実行

```javascript
// メイン関数を実行
manageHallelReservations();
```

### 自動実行（推奨）

5分ごとに自動実行するトリガーを設定：

```javascript
// GASエディタで「setupEbisuTrigger」を選択して実行
setupEbisuTrigger();
```

### トリガー削除

```javascript
// トリガーを削除
deleteEbisuTriggers();
```

## 主要な関数

### メイン処理

| 関数名 | 説明 |
|--------|------|
| `manageHallelReservations()` | メイン処理関数。未処理メールを読み取りカレンダーに反映 |
| `handleReservationComplete()` | 予約完了メールの処理 |
| `handleReservationCancel()` | キャンセルメールの処理 |

### トリガー管理

| 関数名 | 説明 |
|--------|------|
| `setupEbisuTrigger()` | 5分ごとの自動実行トリガーを設定 |
| `deleteEbisuTriggers()` | トリガーを削除 |

### ユーティリティ

| 関数名 | 説明 |
|--------|------|
| `testEbisuSync()` | テスト実行（最新5件のメールのみ処理） |
| `checkEbisuReservations()` | 今後7日間の予約状況を確認 |
| `cleanupProcessedMessages()` | 30日以上前の処理済み記録を削除 |

## 設定項目

```javascript
const CONFIG_EBISU = {
  CALENDAR_ID: 'ebisu@topform.jp',           // カレンダーID
  LABEL_PROCESSED: 'HALLEL_Ebisu/Processed', // 処理済みラベル
  LABEL_ERROR: 'HALLEL_Ebisu/Error',         // エラーラベル
  MAX_SLOTS: 2,                               // 最大予約枠数
  TIME_TOLERANCE_MS: 60000,                   // 時間マッチング許容範囲（1分）
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel 恵比寿'
};
```

## 処理フロー

### 予約完了時

1. Gmailから未処理の予約完了メールを取得
2. メッセージIDで処理済みチェック
3. 顧客名、日時、スタジオを抽出
4. 同じ人の重複予約を削除
5. **予約枠数チェック（2枠制限）**
6. 枠が空いていればカレンダーにイベント作成
7. メッセージIDを処理済みとして記録
8. スレッドに「Processed」ラベル付与

### キャンセル時

1. Gmailから未処理のキャンセルメールを取得
2. メッセージIDで処理済みチェック
3. 顧客名、日時、スタジオを抽出
4. **時間範囲を±5分に拡大して検索**
5. **時間マッチングに±1分の許容範囲を適用**
6. 該当イベントを削除
7. メッセージIDを処理済みとして記録
8. スレッドに「Processed」ラベル付与

## トラブルシューティング

### キャンセルが反映されない

**原因**: イベントのタイトルやスタジオ名が一致していない可能性

**対処法**:
1. `checkEbisuReservations()`で現在の予約を確認
2. ログを確認して、マッチング条件を調整
3. 必要に応じて`TIME_TOLERANCE_MS`を増やす（例: 120000 = 2分）

### 3枠目の予約が入ってしまう

**原因**: 時間の重なり判定が正しく動作していない可能性

**対処法**:
1. `checkAvailableSlots()`のログを確認
2. `checkTimeOverlap()`関数を確認
3. `MAX_SLOTS`設定を確認

### 同じメールが何度も処理される

**原因**: PropertiesServiceの記録が失われた可能性

**対処法**:
1. `cleanupProcessedMessages()`を実行して古い記録を削除
2. Gmailラベル「HALLEL_Ebisu/Processed」を確認
3. 必要に応じて手動でラベルを付与

## メンテナンス

### 月次メンテナンス

```javascript
// 30日以上前の処理済み記録を削除
cleanupProcessedMessages();
```

### ログ確認

GASエディタの「実行ログ」で以下を確認：
- ✅ 成功した処理
- ❌ エラー
- ⚠️ 警告（枠数超過など）

## 今後の拡張案

- [ ] Slackへの通知機能
- [ ] 予約枠超過時のメール通知
- [ ] 複数店舗対応（恵比寿以外）
- [ ] Web UIでの設定変更

## ライセンス

このスクリプトはHALLEL社内用です。

## 変更履歴

### v2.0.0 (2025-11-12)
- キャンセル処理の精度向上
- 2枠制限の実装
- 重複予約チェックの強化
- メッセージ単位での処理済み管理

### v1.0.0 (初期版)
- 基本的な予約同期機能
