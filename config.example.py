"""
HALLEL予約システム - 設定ファイルの例
このファイルを config.py としてコピーして使用してください
"""

# Flask設定
SECRET_KEY = 'your-secret-key-here'  # 本番環境では必ず変更してください
DEBUG = True
PORT = 5001

# 初期管理者パスワード
INITIAL_ADMIN_PASSWORD = 'hallel0000admin'

# Gmail連携設定
GMAIL_SYNC = {
    'MAX_EMAILS_PER_RUN': 50,  # 一度に処理する最大メール数
    'DAYS_TO_SEARCH': 7,        # 過去何日分のメールを対象にするか
    'SEARCH_KEYWORDS': [         # 検索キーワード
        '予約',
        'キャンセル',
        'HALLEL',
        '渋谷店'
    ]
}

# Google Apps Script設定
GAS_CONFIG = {
    'FLASK_API_URL': 'https://your-domain.com/api/process_email',  # 本番環境のURL
}

# 店舗設定
STORE_CONFIG = {
    'NAME': 'HALLEL 渋谷店',
    'MAX_CAPACITY': 7,  # 最大収容人数
}
