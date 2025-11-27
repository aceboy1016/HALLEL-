/**
 * HALLEL予約管理システム - 恵比寿店
 * ドキュメント: /hallel-gas-management/README.md
 */

// ==========================================
// CONFIG設定
// ==========================================
const CONFIG = {
    STORE_NAME: 'ebisu',                       // APIに送信する店舗識別子
    STORE_KEYWORD: '恵比寿',                   // ログ表示用
    SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel',  // Gmail検索クエリ
    INCLUDE_KEYWORD: '恵比寿店',               // 必須キーワード
    EXCLUDE_KEYWORDS: ['半蔵門店', '渋谷店', '中目黒店', '代々木上原店'],  // 除外キーワード
    DEFAULT_ROOM: '個室A',                     // デフォルト部屋名
    API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',  // API URL
    API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',  // API認証キー
    CALENDAR_ID: 'ebisu@topform.jp',           // カレンダーID（nullなら同期なし）
    LABEL_NAME: 'HALLEL_処理済み_恵比寿',      // Gmailラベル名
};

// ==========================================
// 自動実行関数
// ==========================================

/**
 * 未処理メールを処理してAPI送信
 * トリガー: 10分ごと
 */
function processNewReservations() {
    console.log(`【${CONFIG.STORE_KEYWORD}店：処理開始】`);
    // ここに実装が入ります
    // 1. Gmailから検索
    // 2. 店舗判定
    // 3. 予約内容抽出
    // 4. API送信
    // 5. カレンダー同期（設定があれば）
    // 6. ラベル付与
}

// ==========================================
// セットアップ関数
// ==========================================

/**
 * 10分ごとのトリガーを設定
 */
function setupTrigger10min() {
    deleteAllTriggers();
    ScriptApp.newTrigger('processNewReservations')
        .timeBased()
        .everyMinutes(10)
        .create();
    console.log('10分ごとのトリガーを設定しました');
}

/**
 * 1時間ごとのトリガーを設定（オプション）
 */
function setupTrigger1hour() {
    deleteAllTriggers();
    ScriptApp.newTrigger('processNewReservations')
        .timeBased()
        .everyHours(1)
        .create();
    console.log('1時間ごとのトリガーを設定しました');
}

/**
 * 全トリガーを削除
 */
function deleteAllTriggers() {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
        ScriptApp.deleteTrigger(trigger);
    }
    console.log('全トリガーを削除しました');
}

/**
 * 現在のトリガー一覧を表示
 */
function listTriggers() {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
        console.log(`関数: ${trigger.getHandlerFunction()}, タイプ: ${trigger.getEventType()}`);
    }
}

// ==========================================
// メンテナンス関数
// ==========================================

/**
 * 全店舗の処理済みラベルを削除
 * 注意: 実行すると全メールが未処理扱いになります
 */
function removeAllProcessedLabels() {
    const label = GmailApp.getUserLabelByName(CONFIG.LABEL_NAME);
    if (label) {
        label.deleteLabel();
        console.log(`ラベル ${CONFIG.LABEL_NAME} を削除しました`);
    } else {
        console.log(`ラベル ${CONFIG.LABEL_NAME} は存在しません`);
    }
}

/**
 * 過去の全メールをAPI同期
 */
function syncAllToAPI() {
    console.log('全メール同期を開始します...');
    // 実装が必要
}

// ==========================================
// テスト・確認関数
// ==========================================

function testExtractStudio() {
    // 部屋名抽出ロジックのテスト
}

function checkCalendarStatus() {
    if (!CONFIG.CALENDAR_ID) {
        console.log('カレンダー設定なし');
        return;
    }
    try {
        const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
        if (cal) {
            console.log(`カレンダーアクセスOK: ${cal.getName()}`);
        } else {
            console.log(`カレンダーが見つかりません: ${CONFIG.CALENDAR_ID}`);
        }
    } catch (e) {
        console.log(`カレンダーエラー: ${e.message}`);
    }
}
