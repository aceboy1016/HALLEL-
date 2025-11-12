# HALLEL恵比寿店 Google Calendar同期スクリプト

## 概要

GmailからHALLEL恵比寿店の予約完了・キャンセルメールを自動的に読み取り、Google Calendarに反映するGoogle Apps Scriptです。

## 主な改善点（v3.0.0）

### 1. キャンセル処理の精度向上
- **問題**: 完全一致でのみ検索していたため、マッチングに失敗しやすかった
- **改善**:
  - 検索範囲を±5分に拡大
  - 時間マッチングに±1分の許容範囲を設定
  - **スタジオ名に関わらず、名前と時間で一致すればキャンセル**
  - キャンセル対象が見つからない場合も成功として扱う（既に削除済みの可能性を考慮）

### 2. 重複予約処理の強化
- **問題**: スタジオ名抽出失敗時に「Unknown」として登録され、同じ予約が「Unknown」と「個室A/B」で重複
- **改善**:
  - **Unknown/個室A/個室Bを同一予約として扱う**
  - 同じ人・同じ時間の予約は、スタジオ名に関わらず全て削除してから新規作成
  - 重複イベントが自動的に解消される

### 3. 2枠制限を削除
- **旧仕様**: 同時間帯最大2枠の制限あり
- **問題**: 予約メールが届いた時点で予約は確定済み。スクリプト側で枠数チェックする必要なし
- **改善**: **枠数チェックを完全に削除**。予約メールがあれば無条件で登録

### 4. メッセージ単位での処理済み管理
- **改善**:
  - メッセージID単位で処理済み管理
  - PropertiesServiceで処理済みメッセージを記録
  - 30日以上前の記録を自動クリーンアップ

## セットアップ

### 0. 既存のラベルがある場合（重要！）

既に旧スクリプトで「Processed」ラベルを使用していた場合、まず**ラベルの移行**を行ってください：

```javascript
// 1. ラベル状況を確認
checkLabelStatus();

// 2. 古いラベルから新しいラベルへ移行（恵比寿店のメールのみ）
migrateOldProcessedLabel();

// 3. 移行完了後、古いラベルを削除（任意）
deleteOldProcessedLabel();
```

**なぜ移行が必要？**
- 旧ラベル: `Processed`
- 新ラベル: `HALLEL_Ebisu/Processed`
- 移行しないと既存の処理済みメールが再処理される可能性があります

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

### 3. 初回実行（推奨手順）

#### ステップ1: 権限承認
```javascript
// GASエディタで「testEbisuSync」を選択して実行ボタン（▶️）をクリック
testEbisuSync();
```
- 初回は権限承認が必要です
- Googleアカウントでログインし、カレンダーとGmailへのアクセスを許可してください

#### ステップ2: 全メール再処理（カレンダーリセットなし）
```javascript
// カレンダーはそのままで、全メールを再処理
// 重複イベントは自動的に削除される
reprocessAllWithoutCalendarReset();
```

**注意**: レート制限エラーが発生する場合があります。その場合は次のステップ3を実行してください。

#### ステップ3: 自動実行トリガーの設定（必須）
```javascript
// 5分ごとに自動実行するトリガーを設定
setupEbisuTrigger();
```

これで完了です！5分ごとに自動的に未処理メールが処理されます。

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
| `removeDuplicateReservation()` | 重複予約を削除（Unknown/個室A/B全て） |

### トリガー管理

| 関数名 | 説明 |
|--------|------|
| `setupEbisuTrigger()` | 5分ごとの自動実行トリガーを設定 |
| `deleteEbisuTriggers()` | トリガーを削除 |

### リセット・再処理

| 関数名 | 説明 |
|--------|------|
| `reprocessAllWithoutCalendarReset()` | **【推奨】** カレンダーはそのままで全メール再処理 |
| `resetAndReprocessAll()` | カレンダーを削除して全メール再処理（レート制限注意） |
| `clearAllEbisuCalendarEvents()` | カレンダーの全HALLEL予約を削除 |
| `removeAllProcessedLabels()` | 全ての処理済みラベルを外す |
| `clearProcessedMessagesRecord()` | 処理済みメッセージの記録を削除 |

### ユーティリティ

| 関数名 | 説明 |
|--------|------|
| `testEbisuSync()` | テスト実行（最新5件のメールのみ処理） |
| `checkEbisuReservations()` | 今後7日間の予約状況を確認 |
| `cleanupProcessedMessages()` | 30日以上前の処理済み記録を削除 |

### マイグレーション

| 関数名 | 説明 |
|--------|------|
| `checkLabelStatus()` | 古いラベルと新しいラベルの状況を確認 |
| `migrateOldProcessedLabel()` | 古い「Processed」から新しい「HALLEL_Ebisu/Processed」へ移行 |
| `deleteOldProcessedLabel()` | 古い「Processed」ラベルを削除（移行後に実行） |

## 設定項目

```javascript
const CONFIG_EBISU = {
  CALENDAR_ID: 'ebisu@topform.jp',           // カレンダーID
  LABEL_PROCESSED: 'HALLEL_Ebisu/Processed', // 処理済みラベル
  LABEL_ERROR: 'HALLEL_Ebisu/Error',         // エラーラベル
  TIME_TOLERANCE_MS: 60000,                   // 時間マッチング許容範囲（1分）
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel 恵比寿'
};
```

**注**: v3.0.0から`MAX_SLOTS`設定は削除されました

## 処理フロー

### 予約完了時

1. Gmailから未処理の予約完了メールを取得
2. メッセージIDで処理済みチェック
3. 顧客名、日時、スタジオを抽出
4. **同じ人・同じ時間の予約を全て削除（Unknown/個室A/B関係なく）**
5. カレンダーにイベント作成
6. メッセージIDを処理済みとして記録
7. スレッドに「Processed」ラベル付与

### キャンセル時

1. Gmailから未処理のキャンセルメールを取得
2. メッセージIDで処理済みチェック
3. 顧客名、日時、スタジオを抽出
4. **時間範囲を±5分に拡大して検索**
5. **時間マッチングに±1分の許容範囲を適用**
6. **スタジオ名に関わらず、名前と時間で一致する全イベントを削除**
7. メッセージIDを処理済みとして記録
8. スレッドに「Processed」ラベル付与

## トラブルシューティング

### レート制限エラーが発生する

**エラーメッセージ**: `Service invoked too many times for one day: premium calendar`

**原因**: Google Calendar APIの1日あたりの呼び出し上限に達した

**対処法**:
1. **推奨**: `reprocessAllWithoutCalendarReset()`を使う（カレンダー削除をスキップ）
2. `setupEbisuTrigger()`で自動トリガーを設定し、5分ごとに少しずつ処理
3. 24時間待ってから再実行（制限がリセットされる）

### 既に処理済みのメールが再処理される

**原因**: 古い「Processed」ラベルと新しい「HALLEL_Ebisu/Processed」ラベルが混在

**対処法**:
```javascript
// 1. ラベル状況を確認
checkLabelStatus();

// 2. 移行を実行
migrateOldProcessedLabel();

// 3. 古いラベルを削除（任意）
deleteOldProcessedLabel();
```

### キャンセルが反映されない

**原因**: スタジオ名が一致していない、または時間が微妙にずれている

**対処法**:
1. `checkEbisuReservations()`で現在の予約を確認
2. ログを確認して、マッチング条件を調整
3. v3.0.0では**スタジオ名に関わらず名前と時間でマッチング**するため、この問題は大幅に改善されています

### 重複イベントが作成される

**原因**: スタジオ名抽出失敗で「Unknown」と正しいスタジオ名で重複登録

**対処法**:
- v3.0.0では自動的に解決されます
- `removeDuplicateReservation()`が同じ人・時間の予約を全て削除してから新規作成
- `reprocessAllWithoutCalendarReset()`を実行すると、既存の重複も徐々に解消されます

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
- ⚠️ 警告
- 🔄 重複削除の動作

## 現在の状況（2025-11-12）

### 完了した改善
- ✅ 2枠制限を削除
- ✅ Unknown/個室A/個室Bを同一予約として扱う重複削除機能
- ✅ スタジオ名に関わらないキャンセル処理
- ✅ `reprocessAllWithoutCalendarReset()`関数の追加（レート制限対策）

### 次のステップ
1. **`reprocessAllWithoutCalendarReset()`を実行**（既に実行済みの場合はスキップ）
2. **`setupEbisuTrigger()`を実行**（必須！）
3. 5分ごとに自動処理が開始される
4. 重複イベントは新しいメール処理時に自動的に解消される

### 既知の制限
- Google Calendar APIのレート制限: 1日あたりの上限あり
- 大量の過去メールを一度に処理するとレート制限に達する可能性あり
- 対処法: トリガーで少しずつ処理することで回避

## 今後の拡張案

- [ ] Slackへの通知機能
- [ ] Web UIでの設定変更
- [ ] 複数店舗対応（恵比寿以外）
- [ ] スタジオ名抽出の改善（Unknownの発生を減らす）

## ライセンス

このスクリプトはHALLEL社内用です。

## 変更履歴

### v3.0.0 (2025-11-12)
- **【重要】2枠制限を削除**
  - 予約メール受信時点で予約確定済みのため、枠数チェック不要
  - `MAX_SLOTS`設定を削除
  - `checkAvailableSlots()`呼び出しを削除
- **重複予約処理の強化**
  - Unknown/個室A/個室Bを同一予約として扱う
  - `removeDuplicateReservation()`を改善
  - 同じ人・時間の予約は全て削除してから新規作成
- **キャンセル処理の改善**
  - スタジオ名に関わらず、名前と時間で一致すれば削除
  - `handleReservationCancel()`を改善
- **新機能追加**
  - `reprocessAllWithoutCalendarReset()`: カレンダーリセットなしで再処理
  - レート制限対策として推奨

### v2.1.0 (2025-11-12)
- マイグレーション機能追加
  - `migrateOldProcessedLabel()`: 古いラベルから新しいラベルへ移行
  - `deleteOldProcessedLabel()`: 古いラベルを削除
  - `checkLabelStatus()`: ラベル状況確認
- カレンダーリセット機能追加
  - `resetAndReprocessAll()`: 全削除＆再処理
  - `clearAllEbisuCalendarEvents()`: カレンダー削除
  - レート制限対策（5件/3秒待機）

### v2.0.0 (2025-11-12)
- キャンセル処理の精度向上
- 2枠制限の実装
- 重複予約チェックの強化
- メッセージ単位での処理済み管理

### v1.0.0 (初期版)
- 基本的な予約同期機能
