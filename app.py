from flask import Flask, render_template, jsonify, request, redirect, url_for, flash, session
from werkzeug.security import generate_password_hash, check_password_hash
import re
import os
from datetime import datetime, date
import logging
import psycopg2
from psycopg2.pool import SimpleConnectionPool
from psycopg2.extras import RealDictCursor

# --- App Initialization ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
PASSWORD_FILE = 'password.txt'

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
logging.basicConfig(filename='activity.log', level=logging.INFO,
                    format='%(asctime)s - %(message)s')

def log_activity(action):
    logging.info(f"Action: {action}")

# --- Password Management ---
def set_initial_password():
    if not os.path.exists(PASSWORD_FILE):
        hashed_password = generate_password_hash('hallel', method='pbkdf2:sha256')
        with open(PASSWORD_FILE, 'w') as f:
            f.write(hashed_password)

# --- Frontend Routes (Public) ---
@app.route('/')
def booking_status_page():
    return render_template('booking-status.html')

# --- Authentication Routes ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        password = request.form.get('password')
        with open(PASSWORD_FILE, 'r') as f:
            hashed_password = f.read().strip()

        if check_password_hash(hashed_password, password):
            session['logged_in'] = True
            log_activity('Admin login successful')
            flash('ログインしました。', 'success')
            return redirect(url_for('admin_page'))
        else:
            log_activity('Admin login failed')
            flash('パスワードが違います。', 'danger')
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

    try:
        with open('activity.log', 'r') as f:
            logs = f.readlines()
    except FileNotFoundError:
        logs = []

    return render_template('admin.html', logs=reversed(logs))

@app.route('/admin/calendar')
def admin_calendar():
    if not is_logged_in():
        return redirect(url_for('login'))
    return render_template('admin-calendar.html')

@app.route('/admin/change_password', methods=['POST'])
def change_password():
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    new_password = request.form.get('new_password')
    if len(new_password) < 8:
        flash('新しいパスワードは8文字以上である必要があります。', 'danger')
        return redirect(url_for('admin_page'))

    hashed_password = generate_password_hash(new_password, method='pbkdf2:sha256')
    with open(PASSWORD_FILE, 'w') as f:
        f.write(hashed_password)

    log_activity('Password changed')
    flash('パスワードが正常に変更されました。', 'success')
    return redirect(url_for('admin_page'))

# --- API Endpoints ---
@app.route('/api/reservations')
def get_reservations():
    """予約データを取得（日付でグループ化）"""
    debug_mode = request.args.get('debug') == '1'

    conn = get_db_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # デバッグモード：総件数を取得
            if debug_mode:
                cur.execute("SELECT COUNT(*) as total FROM reservations")
                total_count = cur.fetchone()['total']

            cur.execute("""
                SELECT date, start_time, end_time, customer_name, type, is_cancellation
                FROM reservations
                WHERE store = 'shibuya'
                ORDER BY date, start_time
            """)
            rows = cur.fetchall()

        # 日付でグループ化
        reservations_db = {}
        for row in rows:
            date_str = row['date'].strftime('%Y-%m-%d')
            if date_str not in reservations_db:
                reservations_db[date_str] = []

            reservations_db[date_str].append({
                'type': row['type'],
                'start': row['start_time'].strftime('%H:%M'),
                'end': row['end_time'].strftime('%H:%M'),
                'customer_name': row['customer_name']
            })

        # デバッグ情報を追加
        if debug_mode:
            return jsonify({
                'debug': {
                    'postgres_url_exists': bool(os.environ.get('POSTGRES_URL')),
                    'total_reservations': total_count,
                    'shibuya_reservations': len(rows),
                    'code_version': 'v4_debug_in_reservations'
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
                'shibuya',
                data.get('type', 'manual')
            ))
        conn.commit()
        log_activity(f"Manual reservation added: {data}")
        return jsonify({'message': 'Reservation added'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        return_db_conn(conn)

@app.route('/api/reservations/delete', methods=['POST'])
def delete_reservation():
    """予約を削除"""
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM reservations
                WHERE date = %s AND start_time = %s AND end_time = %s
                AND customer_name = %s AND store = 'shibuya'
            """, (
                data.get('date'),
                data.get('start'),
                data.get('end'),
                data.get('customer_name')
            ))
        conn.commit()
        log_activity(f"Reservation deleted: {data}")
        return jsonify({'message': 'Reservation deleted'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
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
def gas_webhook():
    """GASからの予約データを受信"""
    try:
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
            with conn.cursor() as cur:
                for i, res in enumerate(reservations):
                    # キャンセルの場合は削除
                    if res.get('is_cancellation'):
                        cur.execute("""
                            DELETE FROM reservations
                            WHERE date = %s AND start_time = %s AND store = %s AND type = 'gmail'
                        """, (res['date'], res['start'], res.get('store', 'shibuya')))
                        print(f'[DEBUG] Deleted cancellation: {res["date"]} {res["start"]}')
                        log_activity(f"Gmail cancellation: {res['date']} {res['start']}")
                    else:
                        # 予約を追加
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
                            res.get('email_id')
                        ))
                        print(f'[DEBUG] Inserted [{i+1}/{len(reservations)}]: {res["date"]} {res["start"]}-{res["end"]} {res.get("customer_name")}')
                        log_activity(f"Gmail booking added: {res['date']} {res['start']}-{res['end']}")

                print(f'[DEBUG] About to commit {len(reservations)} records')
                conn.commit()
                print('[DEBUG] Commit successful!')

                # データベースから件数を確認
                cur.execute("SELECT COUNT(*) FROM reservations WHERE store = 'shibuya'")
                count_result = cur.fetchone()
                db_count = count_result[0] if count_result else 0

            return jsonify({
                'status': 'success',
                'message': f'{len(reservations)}件の予約を処理しました',
                'debug': {
                    'received': len(reservations),
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

if __name__ == '__main__':
    with app.app_context():
        set_initial_password()
    app.run(debug=True, host='0.0.0.0', port=5001)
