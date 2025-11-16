# 🚀 次にやること（重要）

## ⭐ 最優先：GASエディタで最新コードに更新

**このファイルをGASエディタにコピー&ペーストしてください：**

```
gas-complete-with-management-fixed.js
```

👆 **これが最新・最強版です！**

---

## 📝 手順

1. https://script.google.com/ にアクセス
2. 既存のHALLEL GASプロジェクトを開く
3. GitHubで `gas-complete-with-management-fixed.js` を開く
4. 「Raw」ボタンをクリック → 全選択してコピー
5. GASエディタに貼り付け（既存コードを全て置き換え）
6. 💾 保存
7. ▶️ 関数 `setupFrequentTrigger` を実行

---

## ✅ これで何ができる？

- ✅ 全5店舗（渋谷、代々木上原、中目黒、恵比寿、半蔵門）を1つのGASで処理
- ✅ 全店舗のデータがVercel PostgreSQLに自動送信
- ✅ 5分ごとに新しいメールを自動チェック
- ✅ 統合検索システムが完全動作

---

## 📊 確認方法

GASエディタのログで以下が表示されればOK：

```
📤 Vercel送信: XX件（全店舗統合）
✅ 定期同期完了: XX件（全店舗）
```

---

## 🔧 将来：恵比寿・半蔵門を追加する時

**GAS不要！超簡単：**

`app.py` の `STORE_CONFIG` に追加してデプロイするだけ：

```python
'ebisu': {'name_jp': '恵比寿店', 'max_slots': 2},
'hanzomon': {'name_jp': '半蔵門店', 'max_slots': 4},
```

---

## ❓ 他のGASファイルは？

| ファイル名 | 説明 | 使う？ |
|-----------|------|--------|
| `gas-complete-with-management-fixed.js` | ⭐ **最新・最強版** | ✅ **これを使う** |
| `gas-final-all-stores.js` | 全店舗対応版（渋谷優先） | △ 代替案 |
| `gas-complete-with-management.js` | 管理機能付き | △ 代替案 |
| `gas-yoyogiuehara-sync.js` | 代々木上原専用（旧） | ❌ 不要 |
| `gas-nakameguro-sync.js` | 中目黒専用（旧） | ❌ 不要 |
| `google-apps-script-vercel.js` | 旧版 | ❌ 不要 |

**結論：`gas-complete-with-management-fixed.js` だけ使えばOK！**
