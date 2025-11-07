from flask import Flask, render_template, jsonify, request, redirect, url_for, flash, session
from werkzeug.security import generate_password_hash, check_password_hash
import re
import os
from datetime import datetime
import logging

# --- App Initialization ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
PASSWORD_FILE = 'password.txt'

# --- Logging Setup ---
logging.basicConfig(filename='activity.log', level=logging.INFO, 
                    format='%(asctime)s - %(message)s')

def log_activity(action):
    logging.info(f"Action: {action}")

# --- Password Management ---
def set_initial_password():
    if not os.path.exists(PASSWORD_FILE):
        hashed_password = generate_password_hash('hallel0000admin', method='pbkdf2:sha256')
        with open(PASSWORD_FILE, 'w') as f:
            f.write(hashed_password)

# --- In-memory database ---
reservations_db = {
    '2025-08-01': [
        { 'type': 'gmail', 'start': '14:00', 'end': '15:00' },
        { 'type': 'charter', 'start': '11:00', 'end': '13:00' },
    ],
    '2025-08-02': [
        { 'type': 'gmail', 'start': '10:00', 'end': '11:30' },
    ]
}

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
def admin_calendar_page():
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

# --- API Endpoints (Mostly for admin) ---
@app.route('/api/reservations')
def get_reservations():
    return jsonify(reservations_db)

@app.route('/api/reservations', methods=['POST'])
def add_reservation():
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.json
    date = data.get('date')
    if date not in reservations_db:
        reservations_db[date] = []
    reservations_db[date].append(data)
    log_activity(f"Manual reservation added: {data}")
    return jsonify({'message': 'Reservation added'})

@app.route('/api/reservations/delete', methods=['POST'])
def delete_reservation_api():
    if not is_logged_in():
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.json
    date = data.get('date')
    index = data.get('index')
    if date in reservations_db and 0 <= index < len(reservations_db[date]):
        removed = reservations_db[date].pop(index)
        log_activity(f"Reservation deleted: {removed}")
        return jsonify({'message': 'Reservation deleted'})
    return jsonify({'error': 'Invalid data'}), 400

@app.route('/api/process_email', methods=['POST'])
def process_email():
    """
    Gmail連携用エンドポイント
    GASまたはPythonスクリプトから呼び出される
    """
    try:
        # リクエストデータの取得
        data = request.json
        if not data:
            log_activity('process_email: No JSON data received')
            return jsonify({'error': 'No JSON data provided'}), 400

        # 必須フィールドの確認
        action_type = data.get('action_type')  # 'booking' or 'cancellation'
        date = data.get('date')
        start_time = data.get('start_time')
        end_time = data.get('end_time')  # Only for booking

        log_activity(f"process_email: Received {action_type} for {date} {start_time}")

        if not all([action_type, date, start_time]):
            log_activity('process_email: Missing required fields')
            return jsonify({
                'error': 'Missing required fields',
                'required': ['action_type', 'date', 'start_time']
            }), 400

        # 日付フォーマットの検証
        try:
            datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            log_activity(f'process_email: Invalid date format: {date}')
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

        # 時刻フォーマットの検証
        time_pattern = re.compile(r'^\d{1,2}:\d{2}$')
        if not time_pattern.match(start_time):
            log_activity(f'process_email: Invalid start_time format: {start_time}')
            return jsonify({'error': 'Invalid start_time format. Use HH:MM'}), 400

        # 予約処理
        if action_type == 'booking':
            if not end_time:
                log_activity('process_email: Missing end_time for booking')
                return jsonify({'error': 'End time is required for booking'}), 400

            if not time_pattern.match(end_time):
                log_activity(f'process_email: Invalid end_time format: {end_time}')
                return jsonify({'error': 'Invalid end_time format. Use HH:MM'}), 400

            # 予約を追加
            if date not in reservations_db:
                reservations_db[date] = []

            new_booking = {'type': 'gmail', 'start': start_time, 'end': end_time}
            reservations_db[date].append(new_booking)
            log_activity(f"Gmail booking added: {date} {start_time}-{end_time}")

            return jsonify({
                'status': 'success',
                'message': f"予約を追加しました: {date} {start_time} - {end_time}",
                'booking': new_booking
            }), 200

        # キャンセル処理
        elif action_type == 'cancellation':
            if date not in reservations_db:
                log_activity(f'process_email: No reservations found for date: {date}')
                return jsonify({
                    'error': f'{date}の予約が見つかりませんでした。'
                }), 404

            # 該当予約を検索して削除
            found_and_removed = False
            removed_booking = None

            for i, r in enumerate(reservations_db[date]):
                if r['start'] == start_time and r['type'] == 'gmail':
                    removed_booking = reservations_db[date].pop(i)
                    found_and_removed = True
                    break

            if found_and_removed:
                log_activity(f"Gmail cancellation: {date} {start_time}")
                return jsonify({
                    'status': 'success',
                    'message': f"予約をキャンセルしました: {date} {start_time}",
                    'cancelled': removed_booking
                }), 200
            else:
                log_activity(f'process_email: Matching reservation not found: {date} {start_time}')
                return jsonify({
                    'error': f'該当の予約が見つかりませんでした: {date} {start_time}'
                }), 404

        # 未知のアクションタイプ
        else:
            log_activity(f'process_email: Unknown action_type: {action_type}')
            return jsonify({
                'error': f'不明なアクションタイプです: {action_type}',
                'valid_types': ['booking', 'cancellation']
            }), 400

    except Exception as e:
        log_activity(f'process_email: Exception occurred: {str(e)}')
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500

if __name__ == '__main__':
    with app.app_context():
        set_initial_password()
    app.run(debug=True, host='0.0.0.0', port=5001)

