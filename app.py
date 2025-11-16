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

    # 店舗情報を渡す（タブ生成用）
    stores = [
        {
            'id': store_id,
            'name': info['name_jp'],
            'max_slots': info['max_slots']
        }
        for store_id, info in STORE_CONFIG.items()
    ]

    return render_template('admin.html', logs=reversed(logs), stores=stores)

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
    store = request.args.get('store', 'shibuya')  # 店舗パラメータ取得（デフォルト: shibuya）

    # 店舗バリデーション
    if store not in STORE_CONFIG:
        return jsonify({'error': f'Invalid store: {store}'}), 400

    conn = get_db_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # デバッグモード：総件数を取得
            if debug_mode:
                cur.execute("SELECT COUNT(*) as total FROM reservations WHERE store = %s", (store,))
                total_count = cur.fetchone()['total']

            cur.execute("""
                SELECT date, start_time, end_time, customer_name, type, is_cancellation
                FROM reservations
                WHERE store = %s
                ORDER BY date, start_time
            """, (store,))
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
    store = data.get('store', 'shibuya')  # 店舗パラメータ取得
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
        log_activity(f"Reservation deleted: {data}, deleted_count: {deleted_count}")
        return jsonify({'message': 'Reservation deleted', 'deleted_count': deleted_count})
    except Exception as e:
        conn.rollback()
        print(f'[DELETE ERROR] {str(e)}')
        return jsonify({'error': str(e)}), 500
    finally:
        return_db_conn(conn)

@app.route('/api/admin/cleanup-duplicates', methods=['POST'])
def cleanup_duplicates():
    """重複した予約を削除（管理者専用）"""
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401

    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            # email_idベースの重複を削除（最新のみ残す）
            cur.execute("""
                DELETE FROM reservations
                WHERE id NOT IN (
                    SELECT MAX(id)
                    FROM reservations
                    WHERE email_id IS NOT NULL AND type = 'gmail'
                    GROUP BY email_id, store
                )
                AND email_id IS NOT NULL
                AND type = 'gmail'
            """)
            email_duplicates = cur.rowcount

            # email_idがないGmail予約の重複を削除（日付・時間・顧客名・店舗が同じもの）
            cur.execute("""
                DELETE FROM reservations
                WHERE id NOT IN (
                    SELECT MAX(id)
                    FROM reservations
                    WHERE email_id IS NULL AND type = 'gmail'
                    GROUP BY date, start_time, end_time, customer_name, store
                )
                AND email_id IS NULL
                AND type = 'gmail'
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
            inserted_count = 0
            updated_count = 0
            deleted_count = 0

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

                        log_activity(f"Gmail booking processed: {res['date']} {res['start']}-{res['end']}")

                print(f'[DEBUG] About to commit - inserted: {inserted_count}, updated: {updated_count}, deleted: {deleted_count}')
                conn.commit()
                print('[DEBUG] Commit successful!')

                # データベースから件数を確認
                cur.execute("SELECT COUNT(*) FROM reservations WHERE store = 'shibuya'")
                count_result = cur.fetchone()
                db_count = count_result[0] if count_result else 0

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


if __name__ == '__main__':
    with app.app_context():
        set_initial_password()
    app.run(debug=True, host='0.0.0.0', port=5001)
