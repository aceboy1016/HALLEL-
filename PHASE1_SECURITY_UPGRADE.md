# 🔐 セキュリティアップグレード - フェーズ1

## 📋 概要

700名のお客様への公開に向けて、セキュリティとデータ管理を強化しました。

## ✅ 実装内容

### 1. パスワード管理のDB化
- ❌ **Before**: `password.txt` ファイルに保存（Gitに含まれる）
- ✅ **After**: PostgreSQLの `admin_users` テーブルに保存

### 2. ログ管理のDB化
- ❌ **Before**: `activity.log` ファイルに保存
- ✅ **After**: PostgreSQLの `activity_logs` テーブルに保存
- ✅ ユーザー名、IPアドレス、User-Agentも記録

### 3. SECRET_KEY の環境変数化
- ❌ **Before**: `os.urandom(24)` で毎回ランダム生成（セッションがリセットされる）
- ✅ **After**: 環境変数 `SECRET_KEY` から読み込み（固定値）

### 4. ブルートフォース攻撃対策
- ✅ ログイン試行回数の制限（デフォルト: 5回）
- ✅ 試行回数超過時のアカウントロック（デフォルト: 15分）
- ✅ ログイン試行履歴の記録（`login_attempts` テーブル）
- ✅ ロック解除までの残り時間表示

### 5. 後方互換性の維持
- ✅ 既存のパスワード (`hallel0000admin`) をそのままインポート
- ✅ DBテーブルがない場合はファイルベースにフォールバック

## 🗄️ 新しいDBテーブル

### `admin_users`
```sql
CREATE TABLE admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `activity_logs`
```sql
CREATE TABLE activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES admin_users(id),
    username VARCHAR(50),
    action TEXT NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `login_attempts`
```sql
CREATE TABLE login_attempts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT FALSE
);
```

## 🚀 デプロイ手順

### ステップ1: 環境変数設定

Vercelで以下の環境変数を設定：

```bash
SECRET_KEY=<ランダムな32文字以上の文字列>
```

生成方法：
```python
import secrets
print(secrets.token_urlsafe(32))
```

例：
```
SECRET_KEY=K26oe5JrWtKQsBdh_03IVoyQLp-TKFIxGAsQ4dxu7xE
```

### ステップ2: コードをデプロイ

PRをマージしてVercelにデプロイします。

### ステップ3: 管理画面でマイグレーション実行

1. デプロイ完了後、管理画面にログイン
2. ページ上部に「システム管理」カードが表示される
3. 「🚀 マイグレーション実行」ボタンをクリック
4. 確認ダイアログで「OK」をクリック
5. 成功メッセージが表示されればOK

**これで完了です！** ボタン1つでマイグレーションが実行されます。

### ステップ4: 動作確認

1. ✅ ログイン画面で既存のパスワードでログインできるか
2. ✅ 管理画面でログが表示されるか（DBから）
3. ✅ パスワード変更が機能するか
4. ✅ 5回間違えたパスワードでロックされるか
5. ✅ 15分後にロックが解除されるか

## 📊 セキュリティ設定

### ログイン試行制限
```python
MAX_LOGIN_ATTEMPTS = 5  # 最大試行回数
LOCKOUT_DURATION_MINUTES = 15  # ロック時間（分）
```

これらは `app.py` で変更できます。

## ⚠️ 注意事項

### 1. SECRET_KEYは必須
- 環境変数 `SECRET_KEY` が設定されていない場合、警告が表示されます
- 本番環境では必ず設定してください

### 2. パスワードファイルは残したまま
- 後方互換性のため、`password.txt` はまだ残しています
- フェーズ2でGitから完全削除する予定

### 3. ログファイルも残したまま
- 同様に、`activity.log` もまだ残しています
- DBとファイルの両方に書き込まれます

## 🔜 次のフェーズ（フェーズ2）

1. **リーガル対応**
   - プライバシーポリシー作成
   - 利用規約作成
   - Cookie同意バナー

2. **ファイル削除**
   - Gitから `password.txt` と `activity.log` を完全削除
   - 履歴からも削除（`git filter-branch`）

3. **追加セキュリティ**
   - CSRF対策
   - セキュリティヘッダー追加
   - 管理者URL難読化または2FA

## 📝 変更履歴

- **2025-01-16**: フェーズ1実装完了
  - DB化、ブルートフォース対策、環境変数化

## 🆘 トラブルシューティング

### ログインできない場合

1. マイグレーションが実行されているか確認
```sql
SELECT * FROM admin_users WHERE username = 'admin';
```

2. パスワードハッシュが正しいか確認
```python
from werkzeug.security import check_password_hash
# DBから取得したハッシュと入力パスワードを比較
```

### アカウントがロックされた場合

手動で解除：
```sql
UPDATE admin_users
SET failed_login_attempts = 0, locked_until = NULL
WHERE username = 'admin';
```

## 📧 サポート

問題がある場合は、GitHubのIssueを作成してください。
