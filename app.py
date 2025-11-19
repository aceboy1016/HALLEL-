from flask import Flask, render_template, jsonify, request, redirect, url_for, flash, session
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import generate_password_hash, check_password_hash
import re
import os
from datetime import datetime, date
import logging
import psycopg2
from psycopg2.pool import SimpleConnectionPool
from psycopg2.extras import RealDictCursor

# Google Calendar同期モジュール
from calendar_sync import add_to_calendar, delete_from_calendar, update_in_calendar

# --- App Initialization ---
app = Flask(__name__)
# Use SECRET_KEY from environment variable, or generate one for development
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or os.urandom(24)
if not os.environ.get('SECRET_KEY'):
    print("⚠️  WARNING: SECRET_KEY not set in environment. Using random key (sessions will reset on restart)")

# CSRF Protection
csrf = CSRFProtect(app)

# Rate Limiting (DoS攻撃対策)
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per hour", "2000 per day"],
    storage_uri="memory://",
    strategy="fixed-window"
)

# Legacy password file support (deprecated, will be removed)
PASSWORD_FILE = 'password.txt'

# Security settings
MAX_LOGIN_ATTEMPTS = 5  # Maximum failed login attempts before account lockout
LOCKOUT_DURATION_MINUTES = 15  # How long to lock account after max attempts

# Webhook API Key（GAS認証用）
WEBHOOK_API_KEY = os.environ.get('WEBHOOK_API_KEY')  # Vercelの環境変数で設定
if not WEBHOOK_API_KEY:
    print("⚠️  WARNING: WEBHOOK_API_KEY not set. Webhook endpoint is unprotected!")

# --- Store Configuration ---
STORE_CONFIG = {
    'shibuya': {
        'name_jp': '渋谷店',
        'max_slots': 7
    },
    'yoyogi-uehara': {
        'name_jp': '代々木上原店',
        'max_slots': 2
    },
    'nakameguro': {
        'name_jp': '中目黒店',
        'max_slots': 1  # フリーウエイトエリアのみ
    },
    'ebisu': {
        'name_jp': '恵比寿店',
        'max_slots': 2  # 個室A + 個室B
    },
    'hanzomon': {
        'name_jp': '半蔵門店',
        'max_slots': 4  # 3枠 + 個室1枠
    }
}

# --- Database Connection Pool ---
db_pool = None

def init_db_pool():
    """Initialize database connection pool"""
    global db_pool
    if db_pool is None:
        DATABASE_URL = os.environ.get('POSTGRES_URL')
        if not DATABASE_URL:
            raise Exception("POSTGRES_URL environment variable not set")
        db_pool = SimpleConnectionPool(1, 20, DATABASE_URL)
    return db_pool

def get_db_conn():
    """Get database connection from pool"""
    pool = init_db_pool()
    return pool.getconn()

def return_db_conn(conn):
    """Return database connection to pool"""
    pool = init_db_pool()
    pool.putconn(conn)

# --- Logging Setup ---
# Legacy file logging (deprecated)
logging.basicConfig(filename='activity.log', level=logging.INFO,
                    format='%(asctime)s - %(message)s')

def log_activity(action, user_id=None, username=None):
    """Log activity to database and legacy file"""
    # Legacy file logging
    logging.info(f"Action: {action}")

    # Database logging
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            # Get request context if available
            ip_address = None
            user_agent = None
            if request:
                ip_address = request.remote_addr
                user_agent = request.headers.get('User-Agent')

            # If username not provided, try to get from session
            if not username and 'username' in session:
                username = session['username']

            cur.execute("""
                INSERT INTO activity_logs (user_id, username, action, ip_address, user_agent)
                VALUES (%s, %s, %s, %s, %s)
            """, (user_id, username, action, ip_address, user_agent))
        conn.commit()
        return_db_conn(conn)
    except Exception as e:
        print(f"Failed to log to database: {e}")
        # Continue even if database logging fails

# --- Password Management ---
def validate_password_strength(password):
    """
    パスワードの強度をチェック
    要件: 12文字以上、大文字・小文字・数字・記号を含む

    Returns:
        tuple: (is_valid: bool, error_message: str)
    """
    if len(password) < 12:
        return False, 'パスワードは12文字以上である必要があります。'

    if not re.search(r'[A-Z]', password):
        return False, 'パスワードには少なくとも1つの大文字が必要です。'

    if not re.search(r'[a-z]', password):
        return False, 'パスワードには少なくとも1つの小文字が必要です。'

    if not re.search(r'[0-9]', password):
        return False, 'パスワードには少なくとも1つの数字が必要です。'

    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, 'パスワードには少なくとも1つの記号が必要です（!@#$%^&*等）。'

    return True, ''

def set_initial_password():
    """Legacy function - kept for backwards compatibility"""
    if not os.path.exists(PASSWORD_FILE):
        hashed_password = generate_password_hash('hallel', method='pbkdf2:sha256')
        with open(PASSWORD_FILE, 'w') as f:
            f.write(hashed_password)

def get_user_by_username(username):
    """Get user from database by username"""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, username, password_hash, is_active, failed_login_attempts, locked_until
                FROM admin_users
                WHERE username = %s
            """, (username,))
            user = cur.fetchone()
        return_db_conn(conn)
        return dict(user) if user else None
    except Exception as e:
        print(f"Error getting user: {e}")
        return None

def check_account_locked(user):
    """Check if account is locked due to failed login attempts"""
    if not user or not user.get('locked_until'):
        return False

    from datetime import datetime, timezone
    locked_until = user['locked_until']

    # If locked_until is timezone-naive, make it aware
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    return now < locked_until

def record_login_attempt(username, success, ip_address=None):
    """Record login attempt in database"""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            # Record attempt
            cur.execute("""
                INSERT INTO login_attempts (username, ip_address, success)
                VALUES (%s, %s, %s)
            """, (username, ip_address or request.remote_addr if request else None, success))

            # Update user's failed attempt counter
            if success:
                # Reset failed attempts on successful login
                cur.execute("""
                    UPDATE admin_users
                    SET failed_login_attempts = 0,
                        locked_until = NULL,
                        last_login = CURRENT_TIMESTAMP
                    WHERE username = %s
                """, (username,))
            else:
                # Increment failed attempts
                cur.execute("""
                    UPDATE admin_users
                    SET failed_login_attempts = failed_login_attempts + 1
                    WHERE username = %s
                """, (username,))

                # Check if we need to lock the account
                cur.execute("""
                    SELECT failed_login_attempts FROM admin_users WHERE username = %s
                """, (username,))
                result = cur.fetchone()
                if result and result[0] >= MAX_LOGIN_ATTEMPTS:
                    # Lock account
                    cur.execute("""
                        UPDATE admin_users
                        SET locked_until = CURRENT_TIMESTAMP + INTERVAL '%s minutes'
                        WHERE username = %s
                    """, (LOCKOUT_DURATION_MINUTES, username))

        conn.commit()
        return_db_conn(conn)
    except Exception as e:
        print(f"Error recording login attempt: {e}")

# --- Frontend Routes (Public) ---
@app.route('/')
def shibuya_home():
    """一時的に店舗選択ページにリダイレクト（スマホ確認用）"""
    return redirect('/stores')

    # 元に戻す時は下記のコードに戻す:
    # store_info = STORE_CONFIG['shibuya']
    # return render_template('booking-status.html',
    #                      store='shibuya',
    #                      store_name=store_info['name_jp'],
    #                      max_slots=store_info['max_slots'])

@app.route('/stores')
def store_select():
    """店舗選択画面"""
    stores = [
        {
            'id': store_id,
            'name': info['name_jp'],
            'max_slots': info['max_slots']
        }
        for store_id, info in STORE_CONFIG.items()
    ]
    return render_template('store-select.html', stores=stores)

@app.route('/<store>')
def store_page(store):
    """各店舗の予約状況ページ"""
    if store == 'search':
        # 統合検索ページ
        return integrated_search()

    if store == 'stores':
        # 店舗選択ページ（/stores と /<store> の競合回避）
        return store_select()

    if store not in STORE_CONFIG:
        flash(f'店舗が見つかりません: {store}', 'danger')
        return redirect(url_for('shibuya_home'))

    store_info = STORE_CONFIG[store]
    return render_template('booking-status.html',
                         store=store,
                         store_name=store_info['name_jp'],
                         max_slots=store_info['max_slots'])

@app.route('/search')
def integrated_search():
    """統合検索ページ（全店舗横断）"""
    stores = [
        {
            'id': store_id,
            'name': info['name_jp'],
            'max_slots': info['max_slots']
        }
        for store_id, info in STORE_CONFIG.items()
    ]
    return render_template('integrated-search.html', stores=stores)

# --- Legal Pages ---
@app.route('/privacy-policy')
def privacy_policy():
    """プライバシーポリシーページ"""
    return render_template('privacy-policy.html')

@app.route('/terms-of-service')
def terms_of_service():
    """利用規約ページ"""
    return render_template('terms-of-service.html')

# --- Authentication Routes ---
@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("5 per 5 minutes")  # ブルートフォース攻撃対策
def login():
    if request.method == 'POST':
        username = request.form.get('username', 'admin')  # Default to 'admin' for backwards compatibility
        password = request.form.get('password')

        # Try database authentication first
        user = get_user_by_username(username)

        if user:
            # Check if account is locked
            if check_account_locked(user):
                remaining_time = (user['locked_until'] - datetime.now(user['locked_until'].tzinfo)).seconds // 60
                flash(f'アカウントがロックされています。{remaining_time}分後に再試行してください。', 'danger')
                log_activity(f'Login attempt on locked account: {username}')
                return render_template('login.html')

            # Check if account is active
            if not user['is_active']:
                flash('このアカウントは無効化されています。', 'danger')
                log_activity(f'Login attempt on inactive account: {username}')
                return render_template('login.html')

            # Verify password
            if check_password_hash(user['password_hash'], password):
                session['logged_in'] = True
                session['user_id'] = user['id']
                session['username'] = user['username']
                record_login_attempt(username, True)
                log_activity(f'Admin login successful: {username}', user_id=user['id'], username=username)
                flash('ログインしました。', 'success')
                return redirect(url_for('admin_page'))
            else:
                # Password incorrect
                record_login_attempt(username, False)
                attempts_left = MAX_LOGIN_ATTEMPTS - (user.get('failed_login_attempts', 0) + 1)
                if attempts_left > 0:
                    flash(f'パスワードが違います。残り{attempts_left}回の試行でアカウントがロックされます。', 'danger')
                else:
                    flash(f'パスワードが違います。アカウントが{LOCKOUT_DURATION_MINUTES}分間ロックされました。', 'danger')
                log_activity(f'Admin login failed: {username}')
        else:
            # User not found in database - try legacy file authentication
            try:
                if os.path.exists(PASSWORD_FILE):
                    with open(PASSWORD_FILE, 'r') as f:
                        hashed_password = f.read().strip()

                    if check_password_hash(hashed_password, password):
                        session['logged_in'] = True
                        session['username'] = 'admin'
                        log_activity('Admin login successful (legacy)')
                        flash('ログインしました。', 'success')
                        return redirect(url_for('admin_page'))
            except Exception as e:
                print(f"Legacy authentication failed: {e}")

            flash('ユーザー名またはパスワードが違います。', 'danger')
            log_activity(f'Login failed for unknown user: {username}')

    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    log_activity('Admin logout')
    flash('ログアウトしました。', 'info')
    return redirect(url_for('login'))

# --- Admin Routes (Protected) ---
def is_logged_in():
    return session.get('logged_in', False)

@app.route('/admin')
def admin_page():
    if not is_logged_in():
        return redirect(url_for('login'))

    # Log admin page access
    log_activity('Admin page accessed')

    # Get logs from database
    logs = []
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT username, action, ip_address, created_at
                FROM activity_logs
                ORDER BY created_at DESC
                LIMIT 100
            """)
            db_logs = cur.fetchall()

            # Format logs for display (convert to JST)
            from datetime import timezone, timedelta
            jst = timezone(timedelta(hours=9))

            for log in db_logs:
                # Convert UTC to JST
                created_at_utc = log['created_at']
                if created_at_utc.tzinfo is None:
                    # If timezone-naive, assume UTC
                    created_at_utc = created_at_utc.replace(tzinfo=timezone.utc)
                created_at_jst = created_at_utc.astimezone(jst)

                timestamp = created_at_jst.strftime('%Y-%m-%d %H:%M:%S JST')
                username = log['username'] or 'Unknown'
                action = log['action']
                ip = log['ip_address'] or 'N/A'
                logs.append(f"{timestamp} - User: {username} - Action: {action} - IP: {ip}")

        return_db_conn(conn)
    except Exception as e:
        print(f"Error loading logs from database: {e}")
        # Fallback to file logs
        try:
            with open('activity.log', 'r') as f:
                logs = f.readlines()
        except FileNotFoundError:
            logs = []

    # 店舗情報を渡す（タブ生成用）
    stores = [
        {
            'id': store_id,
            'name': info['name_jp'],
            'max_slots': info['max_slots']
        }
        for store_id, info in STORE_CONFIG.items()
    ]

    return render_template('admin.html', logs=logs, stores=stores)

@app.route('/admin/calendar')
def admin_calendar():
    if not is_logged_in():
        return redirect(url_for('login'))
    log_activity('Admin calendar accessed')
    return render_template('admin-calendar.html')

@app.route('/admin/change_password', methods=['POST'])
@limiter.limit("3 per hour")  # パスワード変更の頻度制限
def change_password():
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    new_password = request.form.get('new_password')

    # パスワード強度チェック
    is_valid, error_message = validate_password_strength(new_password)
    if not is_valid:
        flash(error_message, 'danger')
        return redirect(url_for('admin_page'))

    hashed_password = generate_password_hash(new_password, method='pbkdf2:sha256')

    # Update password in database
    try:
        username = session.get('username', 'admin')
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE admin_users
                SET password_hash = %s, updated_at = CURRENT_TIMESTAMP
                WHERE username = %s
            """, (hashed_password, username))
        conn.commit()
        return_db_conn(conn)

        log_activity('Password changed', username=username)
        flash('パスワードが正常に変更されました。', 'success')
    except Exception as e:
        print(f"Error updating password in database: {e}")
        # Fallback to file-based password
        try:
            with open(PASSWORD_FILE, 'w') as f:
                f.write(hashed_password)
            log_activity('Password changed (legacy)')
            flash('パスワードが正常に変更されました。', 'success')
        except Exception as file_error:
            print(f"Error updating password file: {file_error}")
            flash('パスワードの変更に失敗しました。', 'danger')

    return redirect(url_for('admin_page'))

@app.route('/admin/run-migration', methods=['POST'])
def run_migration_endpoint():
    """Run database migration (admin only)"""
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check if tables already exist
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name IN ('admin_users', 'activity_logs', 'login_attempts')
            """)
            existing_tables = [row['table_name'] for row in cur.fetchall()]

            if len(existing_tables) == 3:
                return jsonify({
                    'status': 'warning',
                    'message': 'マイグレーションは既に実行されています。',
                    'tables': existing_tables
                })

            # Read migration file
            migration_file = 'migrations/001_add_security_tables.sql'
            with open(migration_file, 'r') as f:
                sql = f.read()

            # Execute migration
            cur.execute(sql)

        conn.commit()

        # Verify tables were created
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name IN ('admin_users', 'activity_logs', 'login_attempts')
                ORDER BY table_name
            """)
            tables = [row['table_name'] for row in cur.fetchall()]

            # Check default admin user
            cur.execute("SELECT username, created_at FROM admin_users WHERE username = 'admin'")
            admin = cur.fetchone()

        return_db_conn(conn)

        log_activity('Database migration completed', username=session.get('username'))

        return jsonify({
            'status': 'success',
            'message': 'マイグレーションが正常に完了しました。',
            'tables_created': tables,
            'admin_user': dict(admin) if admin else None
        })

    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            return_db_conn(conn)

        log_activity(f'Migration failed: {str(e)}', username=session.get('username'))

        return jsonify({
            'status': 'error',
            'message': f'マイグレーションに失敗しました: {str(e)}'
        }), 500

# --- API Endpoints ---
@app.route('/api/reservations')
def get_reservations():
    """予約データを取得（日付でグループ化）"""
    debug_mode = request.args.get('debug') == '1'
    store_filter = request.args.get('store')  # 店舗パラメータ（オプション）

    # 店舗バリデーション（指定されている場合のみ）
    if store_filter and store_filter not in STORE_CONFIG:
        return jsonify({'error': f'Invalid store: {store_filter}'}), 400

    conn = get_db_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # デバッグモード：総件数を取得
            if debug_mode:
                if store_filter:
                    cur.execute("SELECT COUNT(*) as total FROM reservations WHERE store = %s", (store_filter,))
                else:
                    cur.execute("SELECT COUNT(*) as total FROM reservations")
                total_count = cur.fetchone()['total']

            # クエリ：店舗フィルタがあれば特定店舗、なければ全店舗
            if store_filter:
                cur.execute("""
                    SELECT date, start_time, end_time, customer_name, type, is_cancellation, store
                    FROM reservations
                    WHERE store = %s
                    ORDER BY date, start_time
                """, (store_filter,))
            else:
                cur.execute("""
                    SELECT date, start_time, end_time, customer_name, type, is_cancellation, store
                    FROM reservations
                    ORDER BY date, start_time
                """)
            rows = cur.fetchall()

        # 日付でグループ化
        reservations_db = {}
        for row in rows:
            date_str = row['date'].strftime('%Y-%m-%d')
            if date_str not in reservations_db:
                reservations_db[date_str] = []

            # 店舗情報を含める
            store_id = row['store']
            store_name = STORE_CONFIG.get(store_id, {}).get('name_jp', store_id)

            reservations_db[date_str].append({
                'type': row['type'],
                'start': row['start_time'].strftime('%H:%M'),
                'end': row['end_time'].strftime('%H:%M'),
                'customer_name': row['customer_name'],
                'store_id': store_id,
                'store_name': store_name
            })

        # デバッグ情報を追加
        if debug_mode:
            return jsonify({
                'debug': {
                    'postgres_url_exists': bool(os.environ.get('POSTGRES_URL')),
                    'total_reservations': total_count,
                    'filtered_reservations': len(rows),
                    'store_filter': store_filter or 'all',
                    'code_version': 'v5_multi_store_support'
                },
                'reservations': reservations_db
            })

        return jsonify(reservations_db)
    finally:
        return_db_conn(conn)

@app.route('/api/reservations', methods=['POST'])
def add_reservation():
    """手動で予約を追加"""
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    store = data.get('store', 'shibuya')  # 店舗パラメータ取得

    # 店舗バリデーション
    if store not in STORE_CONFIG:
        return jsonify({'error': f'Invalid store: {store}'}), 400

    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO reservations (date, start_time, end_time, customer_name, store, type)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                data.get('date'),
                data.get('start'),
                data.get('end'),
                data.get('customer_name', 'N/A'),
                store,
                data.get('type', 'manual')
            ))
        conn.commit()

        # Google Calendar同期（恵比寿・半蔵門のみ）
        if store in ['ebisu', 'hanzomon']:
            add_to_calendar(
                store=store,
                date=data.get('date'),
                start_time=data.get('start'),
                end_time=data.get('end'),
                customer_name=data.get('customer_name', 'N/A')
            )

        log_activity(f"Manual reservation added: {data}")
        return jsonify({'message': 'Reservation added'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        return_db_conn(conn)

@app.route('/api/reservations/delete', methods=['POST'])
@limiter.limit("30 per minute")  # 予約削除の頻度制限
def delete_reservation():
    """予約を削除"""
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    # store_id または store パラメータ取得（両方に対応）
    store = data.get('store_id') or data.get('store', 'shibuya')
    print(f'[DELETE] Received data: {data}')

    # 店舗バリデーション
    if store not in STORE_CONFIG:
        return jsonify({'error': f'Invalid store: {store}'}), 400

    conn = get_db_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # まず該当する予約を検索
            cur.execute("""
                SELECT id, customer_name, date, start_time, end_time
                FROM reservations
                WHERE date = %s AND start_time = %s AND end_time = %s
                AND store = %s
            """, (
                data.get('date'),
                data.get('start'),
                data.get('end'),
                store
            ))
            found_reservations = cur.fetchall()
            print(f'[DELETE] Found {len(found_reservations)} matching reservations')

            if not found_reservations:
                return jsonify({'error': 'Reservation not found'}), 404

            # customer_nameでフィルタリング（完全一致またはNULL対応）
            target_customer = data.get('customer_name')
            reservation_to_delete = None

            for res in found_reservations:
                if res['customer_name'] == target_customer or (res['customer_name'] is None and target_customer == 'N/A'):
                    reservation_to_delete = res
                    break

            if not reservation_to_delete:
                print(f'[DELETE] No reservation matched customer_name: {target_customer}')
                # customer_nameが一致しない場合、最初の予約を削除
                reservation_to_delete = found_reservations[0]

            # IDで削除
            cur.execute("""
                DELETE FROM reservations
                WHERE id = %s
            """, (reservation_to_delete['id'],))

            deleted_count = cur.rowcount
            print(f'[DELETE] Deleted {deleted_count} reservation(s) with ID {reservation_to_delete["id"]}')

        conn.commit()

        # Google Calendar同期（恵比寿・半蔵門のみ）
        if store in ['ebisu', 'hanzomon']:
            delete_from_calendar(
                store=store,
                date=data.get('date'),
                start_time=data.get('start'),
                end_time=data.get('end')
            )

        log_activity(f"Reservation deleted: {data}, deleted_count: {deleted_count}")
        return jsonify({'message': 'Reservation deleted', 'deleted_count': deleted_count})
    except Exception as e:
        conn.rollback()
        print(f'[DELETE ERROR] {str(e)}')
        return jsonify({'error': str(e)}), 500
    finally:
        return_db_conn(conn)

@app.route('/api/admin/cleanup-duplicates', methods=['POST'])
@limiter.limit("10 per hour")  # 重複削除の頻度制限（負荷の高い操作）
def cleanup_duplicates():
    """重複した予約を削除（管理者専用）"""
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            # まず、email_idが重複している予約を削除（email_idベース）
            cur.execute("""
                DELETE FROM reservations r1
                USING reservations r2
                WHERE r1.id < r2.id
                AND r1.email_id IS NOT NULL
                AND r1.email_id != ''
                AND r1.email_id = r2.email_id
                AND r1.store = r2.store
                AND r1.type = 'gmail'
                AND r2.type = 'gmail'
            """)
            email_duplicates = cur.rowcount

            # 次に、時間・顧客名・店舗が完全一致する予約を削除（時間ベース）
            cur.execute("""
                DELETE FROM reservations r1
                USING reservations r2
                WHERE r1.id < r2.id
                AND r1.date = r2.date
                AND r1.start_time = r2.start_time
                AND r1.end_time = r2.end_time
                AND r1.customer_name = r2.customer_name
                AND r1.store = r2.store
                AND r1.type = 'gmail'
                AND r2.type = 'gmail'
            """)
            time_duplicates = cur.rowcount

        conn.commit()
        total_deleted = email_duplicates + time_duplicates
        log_activity(f"Cleaned up {total_deleted} duplicate reservations (email: {email_duplicates}, time: {time_duplicates})")

        return jsonify({
            'status': 'success',
            'message': f'{total_deleted}件の重複予約を削除しました',
            'deleted': {
                'by_email_id': email_duplicates,
                'by_time': time_duplicates,
                'total': total_deleted
            }
        })
    except Exception as e:
        conn.rollback()
        log_activity(f"Cleanup failed: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        return_db_conn(conn)

@app.route('/api/admin/debug-duplicates')
def debug_duplicates():
    """重複データをデバッグ（管理者専用）"""
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    conn = get_db_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 重複を検出
            cur.execute("""
                SELECT
                    date, start_time, end_time, customer_name, store, type,
                    email_id, id, created_at,
                    COUNT(*) OVER (PARTITION BY date, start_time, end_time, customer_name, store) as duplicate_count
                FROM reservations
                WHERE type = 'gmail'
                ORDER BY date DESC, start_time, customer_name, id
                LIMIT 100
            """)
            rows = cur.fetchall()

            # 重複のみをフィルタ
            duplicates = [dict(row) for row in rows if row['duplicate_count'] > 1]

            return jsonify({
                'total_checked': len(rows),
                'duplicates_found': len(duplicates),
                'duplicates': duplicates[:20]  # 最初の20件のみ
            })
    finally:
        return_db_conn(conn)

@app.route('/api/debug/env')
def debug_env():
    """デバッグ用：環境変数とDB接続確認"""
    try:
        postgres_url_exists = bool(os.environ.get('POSTGRES_URL'))
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM reservations")
        count = cur.fetchone()[0]

        result = {
            'postgres_url_exists': postgres_url_exists,
            'db_connection_successful': True,
            'reservations_count': count,
            'code_version': 'v3_fixed'
        }

        return_db_conn(conn)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            'error': str(e),
            'postgres_url_exists': bool(os.environ.get('POSTGRES_URL')),
            'code_version': 'v3_fixed_error'
        }), 500

@app.route('/api/gas/webhook', methods=['POST'])
@csrf.exempt  # 外部システム（GAS）からのリクエストなのでCSRF免除
@limiter.limit("60 per minute")  # GASからの頻繁な同期を許可
def gas_webhook():
    """GASからの予約データを受信"""
    try:
        # Webhook認証チェック
        if WEBHOOK_API_KEY:
            api_key = request.headers.get('X-API-Key')
            if not api_key or api_key != WEBHOOK_API_KEY:
                log_activity(f'Unauthorized webhook attempt from {request.remote_addr}')
                return jsonify({'error': 'Unauthorized: Invalid API Key'}), 401

        print('[DEBUG] gas_webhook called')
        print(f'[DEBUG] POSTGRES_URL exists: {bool(os.environ.get("POSTGRES_URL"))}')
        data = request.json
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400

        reservations = data.get('reservations', [])
        print(f'[DEBUG] Received {len(reservations)} reservations')
        if not reservations:
            return jsonify({'error': 'No reservations provided'}), 400

        conn = get_db_conn()
        print(f'[DEBUG] Got DB connection: {conn}')
        try:
            inserted_count = 0
            updated_count = 0
            deleted_count = 0

            # Calendar同期が必要なイベントを収集
            calendar_events_to_add = []
            calendar_events_to_delete = []

            with conn.cursor() as cur:
                for i, res in enumerate(reservations):
                    # キャンセルの場合は削除
                    if res.get('is_cancellation'):
                        email_id = res.get('email_id')
                        if email_id:
                            cur.execute("""
                                DELETE FROM reservations
                                WHERE email_id = %s AND store = %s AND type = 'gmail'
                            """, (email_id, res.get('store', 'shibuya')))
                        else:
                            # email_idがない場合は日付・時間で削除
                            cur.execute("""
                                DELETE FROM reservations
                                WHERE date = %s AND start_time = %s AND store = %s AND type = 'gmail'
                            """, (res['date'], res['start'], res.get('store', 'shibuya')))
                        deleted_count += cur.rowcount
                        print(f'[DEBUG] Deleted cancellation: {res["date"]} {res["start"]}')

                        # Google Calendar同期が必要な場合はリストに追加
                        if res.get('store', 'shibuya') in ['ebisu', 'hanzomon']:
                            calendar_events_to_delete.append({
                                'store': res.get('store', 'shibuya'),
                                'date': res['date'],
                                'start_time': res['start'],
                                'end_time': res.get('end', res['start'])
                            })

                        log_activity(f"Gmail cancellation: {res['date']} {res['start']}")
                    else:
                        email_id = res.get('email_id')

                        # email_idがある場合は重複チェック
                        if email_id:
                            cur.execute("""
                                SELECT id FROM reservations
                                WHERE email_id = %s AND store = %s
                            """, (email_id, res.get('store', 'shibuya')))
                            existing = cur.fetchone()

                            if existing:
                                # 既存の予約を更新
                                cur.execute("""
                                    UPDATE reservations
                                    SET date = %s, start_time = %s, end_time = %s, customer_name = %s
                                    WHERE email_id = %s AND store = %s
                                """, (
                                    res['date'],
                                    res['start'],
                                    res['end'],
                                    res.get('customer_name', 'N/A'),
                                    email_id,
                                    res.get('store', 'shibuya')
                                ))
                                updated_count += 1
                                print(f'[DEBUG] Updated [{i+1}/{len(reservations)}]: {res["date"]} {res["start"]}-{res["end"]} {res.get("customer_name")}')
                            else:
                                # 新規予約を追加
                                cur.execute("""
                                    INSERT INTO reservations (date, start_time, end_time, customer_name, store, type, source, email_id)
                                    VALUES (%s, %s, %s, %s, %s, 'gmail', %s, %s)
                                """, (
                                    res['date'],
                                    res['start'],
                                    res['end'],
                                    res.get('customer_name', 'N/A'),
                                    res.get('store', 'shibuya'),
                                    res.get('source', 'gas_sync'),
                                    email_id
                                ))
                                inserted_count += 1
                                print(f'[DEBUG] Inserted [{i+1}/{len(reservations)}]: {res["date"]} {res["start"]}-{res["end"]} {res.get("customer_name")}')

                                # Google Calendar同期が必要な場合はリストに追加
                                if res.get('store', 'shibuya') in ['ebisu', 'hanzomon']:
                                    calendar_events_to_add.append({
                                        'store': res.get('store', 'shibuya'),
                                        'date': res['date'],
                                        'start_time': res['start'],
                                        'end_time': res['end'],
                                        'customer_name': res.get('customer_name', 'N/A')
                                    })
                        else:
                            # email_idがない場合は日付・時間・店舗で重複チェック（より厳格）
                            cur.execute("""
                                SELECT id, customer_name FROM reservations
                                WHERE date = %s AND start_time = %s AND end_time = %s
                                AND store = %s AND type = 'gmail'
                            """, (
                                res['date'],
                                res['start'],
                                res['end'],
                                res.get('store', 'shibuya')
                            ))
                            existing = cur.fetchone()

                            if existing:
                                # 既存の予約を更新（顧客名を最新に）
                                cur.execute("""
                                    UPDATE reservations
                                    SET customer_name = %s
                                    WHERE id = %s
                                """, (
                                    res.get('customer_name', 'N/A'),
                                    existing[0]
                                ))
                                updated_count += 1
                                print(f'[DEBUG] Updated (no email_id) [{i+1}/{len(reservations)}]: {res["date"]} {res["start"]}-{res["end"]} {res.get("customer_name")}')
                            else:
                                # 重複がない場合のみ追加
                                cur.execute("""
                                    INSERT INTO reservations (date, start_time, end_time, customer_name, store, type, source, email_id)
                                    VALUES (%s, %s, %s, %s, %s, 'gmail', %s, %s)
                                """, (
                                    res['date'],
                                    res['start'],
                                    res['end'],
                                    res.get('customer_name', 'N/A'),
                                    res.get('store', 'shibuya'),
                                    res.get('source', 'gas_sync'),
                                    None
                                ))
                                inserted_count += 1
                                print(f'[DEBUG] Inserted [{i+1}/{len(reservations)}]: {res["date"]} {res["start"]}-{res["end"]} {res.get("customer_name")}')

                                # Google Calendar同期が必要な場合はリストに追加
                                if res.get('store', 'shibuya') in ['ebisu', 'hanzomon']:
                                    calendar_events_to_add.append({
                                        'store': res.get('store', 'shibuya'),
                                        'date': res['date'],
                                        'start_time': res['start'],
                                        'end_time': res['end'],
                                        'customer_name': res.get('customer_name', 'N/A')
                                    })

                        log_activity(f"Gmail booking processed: {res['date']} {res['start']}-{res['end']}")

                print(f'[DEBUG] About to commit - inserted: {inserted_count}, updated: {updated_count}, deleted: {deleted_count}')
                conn.commit()
                print('[DEBUG] Commit successful!')

                # データベースから件数を確認
                cur.execute("SELECT COUNT(*) FROM reservations WHERE store = 'shibuya'")
                count_result = cur.fetchone()
                db_count = count_result[0] if count_result else 0

            # データベース操作完了後、Calendar同期を実行
            print(f'[DEBUG] Calendar sync - To add: {len(calendar_events_to_add)}, To delete: {len(calendar_events_to_delete)}')

            for event in calendar_events_to_delete:
                try:
                    delete_from_calendar(
                        store=event['store'],
                        date=event['date'],
                        start_time=event['start_time'],
                        end_time=event['end_time']
                    )
                    print(f'[DEBUG] Calendar delete success: {event["store"]} {event["date"]} {event["start_time"]}')
                except Exception as cal_err:
                    print(f'[WARNING] Calendar delete failed: {str(cal_err)}')

            for event in calendar_events_to_add:
                try:
                    add_to_calendar(
                        store=event['store'],
                        date=event['date'],
                        start_time=event['start_time'],
                        end_time=event['end_time'],
                        customer_name=event['customer_name']
                    )
                    print(f'[DEBUG] Calendar add success: {event["store"]} {event["date"]} {event["start_time"]} - {event["customer_name"]}')
                except Exception as cal_err:
                    print(f'[WARNING] Calendar add failed: {str(cal_err)}')

            return jsonify({
                'status': 'success',
                'message': f'予約を処理しました（追加:{inserted_count}, 更新:{updated_count}, 削除:{deleted_count}）',
                'debug': {
                    'received': len(reservations),
                    'inserted': inserted_count,
                    'updated': updated_count,
                    'deleted': deleted_count,
                    'db_count_after_insert': db_count,
                    'commit_successful': True,
                    'postgres_url_exists': bool(os.environ.get('POSTGRES_URL')),
                    'connection_type': str(type(conn).__name__)
                }
            }), 200

        except Exception as e:
            print(f'[DEBUG] Error occurred: {str(e)}')
            conn.rollback()
            log_activity(f'gas_webhook error: {str(e)}')
            return jsonify({'error': str(e)}), 500
        finally:
            return_db_conn(conn)
            print('[DEBUG] Connection returned to pool')

    except Exception as e:
        log_activity(f'gas_webhook exception: {str(e)}')
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500

# ============================================================
# Gmail予約全削除API
# ============================================================

@app.route('/api/gas/clear-gmail-reservations', methods=['DELETE'])
@csrf.exempt
def clear_gmail_reservations():
    """
    Gmail経由の予約データを全削除

    Headers:
    - X-API-Key: Wh00k@2025!Secure$Token#ABC123XYZ

    Response:
    {
        "status": "success",
        "message": "Gmail予約を全削除しました",
        "deleted_count": 123
    }
    """
    # API Key認証
    api_key = request.headers.get('X-API-Key')
    if api_key != 'Wh00k@2025!Secure$Token#ABC123XYZ':
        return jsonify({'error': 'Unauthorized'}), 401

    print('[DEBUG] Clear Gmail reservations request received')

    conn = None
    try:
        conn = get_db_conn()
        cur = conn.cursor()

        # 削除前の件数を確認
        cur.execute("SELECT COUNT(*) FROM reservations WHERE type = 'gmail'")
        count_before = cur.fetchone()[0]
        print(f'[DEBUG] Gmail reservations before deletion: {count_before}')

        # Gmail予約を全削除
        cur.execute("DELETE FROM reservations WHERE type = 'gmail'")
        deleted_count = cur.rowcount

        conn.commit()
        print(f'[DEBUG] Deleted {deleted_count} Gmail reservations')

        # 削除後の確認
        cur.execute("SELECT COUNT(*) FROM reservations WHERE type = 'gmail'")
        count_after = cur.fetchone()[0]

        cur.close()

        log_activity(f'Cleared all Gmail reservations: {deleted_count} records deleted')

        result = {
            'status': 'success',
            'message': f'{deleted_count}件のGmail予約を削除しました',
            'deleted_count': deleted_count,
            'count_before': count_before,
            'count_after': count_after
        }

        return jsonify(result), 200

    except Exception as e:
        print(f'[DEBUG] Error deleting Gmail reservations: {str(e)}')
        if conn:
            conn.rollback()
        log_activity(f'clear_gmail_reservations error: {str(e)}')
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500

    finally:
        if conn:
            return_db_conn(conn)
            print('[DEBUG] Connection returned to pool')

# ============================================================
# 空き状況API（統合検索システム用）
# ============================================================

@app.route('/api/availability', methods=['GET'])
def check_availability():
    """
    空き状況取得API

    Query Parameters:
    - date: 日付 (YYYY-MM-DD)
    - start_time: 開始時刻 (HH:MM)
    - end_time: 終了時刻 (HH:MM)
    - store: 店舗ID (shibuya, yoyogi-uehara, nakameguro, ebisu, hanzomon)

    Response:
    {
        "store": "shibuya",
        "store_name": "渋谷店",
        "date": "2025-12-01",
        "start_time": "10:00",
        "end_time": "12:00",
        "available": true,
        "total_slots": 7,
        "occupied_slots": 3,
        "remaining_slots": 4
    }
    """
    try:
        # パラメータ取得
        date = request.args.get('date')
        start_time = request.args.get('start_time')
        end_time = request.args.get('end_time')
        store = request.args.get('store', 'shibuya')

        # バリデーション
        if not all([date, start_time, end_time]):
            return jsonify({
                'error': 'Missing required parameters',
                'required': ['date', 'start_time', 'end_time']
            }), 400

        # 店舗情報取得
        if store not in STORE_CONFIG:
            return jsonify({
                'error': 'Invalid store',
                'valid_stores': list(STORE_CONFIG.keys())
            }), 400

        store_info = STORE_CONFIG[store]
        max_slots = store_info['max_slots']
        store_name = store_info['name_jp']

        # データベースから予約数を取得
        conn = get_db_conn()
        try:
            with conn.cursor() as cur:
                # 指定日時に重なる予約を検索
                cur.execute("""
                    SELECT COUNT(*) FROM reservations
                    WHERE date = %s
                    AND start_time < %s
                    AND end_time > %s
                    AND store = %s
                """, (date, end_time, start_time, store))

                occupied_slots = cur.fetchone()[0]
                remaining_slots = max_slots - occupied_slots

                return jsonify({
                    'store': store,
                    'store_name': store_name,
                    'date': date,
                    'start_time': start_time,
                    'end_time': end_time,
                    'available': remaining_slots > 0,
                    'total_slots': max_slots,
                    'occupied_slots': occupied_slots,
                    'remaining_slots': remaining_slots
                }), 200

        finally:
            return_db_conn(conn)

    except Exception as e:
        log_activity(f'availability_check error: {str(e)}')
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500


@app.route('/api/stores', methods=['GET'])
def get_stores():
    """
    全店舗情報取得API

    Response:
    {
        "stores": [
            {"id": "shibuya", "name": "渋谷店", "max_slots": 7},
            ...
        ]
    }
    """
    try:
        stores = [
            {
                'id': store_id,
                'name': info['name_jp'],
                'max_slots': info['max_slots']
            }
            for store_id, info in STORE_CONFIG.items()
        ]

        return jsonify({
            'stores': stores,
            'total': len(stores)
        }), 200

    except Exception as e:
        log_activity(f'get_stores error: {str(e)}')
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500


# --- Security Headers ---
@app.after_request
def set_security_headers(response):
    """セキュリティヘッダーを設定"""
    # クリックジャッキング対策
    response.headers['X-Frame-Options'] = 'DENY'

    # MIME type sniffing 対策
    response.headers['X-Content-Type-Options'] = 'nosniff'

    # XSS対策（レガシー）
    response.headers['X-XSS-Protection'] = '1; mode=block'

    # HTTPS強制（本番環境のみ）
    if not app.debug:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'

    # Content Security Policy（厳格版）
    # Note: Bootstrap CDN、Google Fonts、Vercel Liveを許可
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://vercel.live; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self' https://cdn.jsdelivr.net https://vercel.live"
    )

    # Referrer Policy
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

    return response


if __name__ == '__main__':
    with app.app_context():
        set_initial_password()

    # 本番環境ではデバッグモードを無効化
    DEBUG_MODE = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    app.run(debug=DEBUG_MODE, host='0.0.0.0', port=5001)
