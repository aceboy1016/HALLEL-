# HALLEL 統合予約検索システム

## 概要
全店舗の空き状況を横断検索できるシステム。利用者が希望日時を入力すると、どの店舗なら予約可能かが一目でわかるようになります。

**目的:**
- 混雑防止
- 退会防止
- ユーザー体験向上

---

## 店舗情報

| 店舗名 | 最大枠数 | システム | データソース |
|--------|---------|---------|-------------|
| 恵比寿 | 2枠（個室A + 個室B） | Google Apps Script | Google Calendar |
| 半蔵門 | 4枠（3枠 + 個室1枠） | Google Apps Script | Google Calendar |
| 渋谷 | 7枠 | Vercel (Flask) | PostgreSQL |
| 代々木上原 | 2枠 | TBD | TBD |
| 中目黒 | 1枠 | TBD | TBD |

---

## システムアーキテクチャ

```
┌─────────────────────────────────────────────────┐
│  統合予約検索フロントエンド                      │
│  (Vercel/Next.js - 新規プロジェクト)            │
│  https://hallel-search.vercel.app (仮)          │
└──────────────────┬──────────────────────────────┘
                   │
       ┌───────────┼───────────┐
       │           │           │
       v           v           v
┌──────────┐ ┌──────────┐ ┌──────────┐
│恵比寿 API│ │半蔵門 API│ │渋谷 API  │
│  (GAS)   │ │  (GAS)   │ │(Vercel)  │
└────┬─────┘ └────┬─────┘ └────┬─────┘
     │            │            │
     v            v            v
[Google Cal] [Google Cal] [PostgreSQL]

       ┌──────────┐ ┌──────────┐
       │代々木 API│ │中目黒 API│
       │  (TBD)   │ │  (TBD)   │
       └────┬─────┘ └────┬─────┘
            │            │
            v            v
         [TBD]        [TBD]
```

---

## API仕様（統一フォーマット）

### リクエスト
```
GET /api/availability?date=2025-12-01&start_time=10:00&end_time=12:00
```

### レスポンス
```json
{
  "store": "ebisu",
  "store_name": "恵比寿店",
  "date": "2025-12-01",
  "start_time": "10:00",
  "end_time": "12:00",
  "available": true,
  "total_slots": 2,
  "occupied_slots": 1,
  "remaining_slots": 1,
  "studios": {
    "個室A": "available",
    "個室B": "occupied"
  }
}
```

**フィールド説明:**
- `store`: 店舗ID (ebisu, hanzomon, shibuya, yoyogiuehara, nakameguro)
- `store_name`: 日本語店舗名
- `available`: 予約可能か (boolean)
- `total_slots`: 合計枠数
- `occupied_slots`: 予約済み枠数
- `remaining_slots`: 残り枠数
- `studios`: スタジオごとの詳細（オプション）

---

## 実装ステップ

### Phase 1: 各店舗のシステム構築 ✅進行中
- [x] 恵比寿店（GAS + Google Calendar）
- [x] 半蔵門店（GAS + Google Calendar）
- [x] 渋谷店（Vercel + PostgreSQL）
- [ ] 代々木上原店
- [ ] 中目黒店

### Phase 2: API作成（Phase 1完了後）
各店舗に空き状況取得APIを追加

#### 恵比寿店・半蔵門店（GAS）
`gas-ebisu-calendar-sync.js` / `gas-hanzomon-calendar-sync.js` に追加:

```javascript
/**
 * Web APIエンドポイント - 空き状況取得
 */
function doGet(e) {
  try {
    const params = e.parameter;
    const date = params.date;
    const startTime = params.start_time;
    const endTime = params.end_time;

    // バリデーション
    if (!date || !startTime || !endTime) {
      return createJsonResponse({
        error: 'Missing required parameters: date, start_time, end_time'
      }, 400);
    }

    const calendar = CalendarApp.getCalendarById(CONFIG_EBISU.CALENDAR_ID);

    // 日時範囲を作成
    const searchStart = new Date(`${date}T${startTime}:00`);
    const searchEnd = new Date(`${date}T${endTime}:00`);

    // その時間帯のイベントを取得
    const events = calendar.getEvents(searchStart, searchEnd);

    // HALLEL予約のみフィルタ
    const hallelEvents = events.filter(event =>
      event.getTitle().includes('HALLEL-')
    );

    // スタジオごとの空き状況
    const studios = {
      '個室A': 'available',
      '個室B': 'available'
    };

    hallelEvents.forEach(event => {
      const title = event.getTitle();
      if (title.includes('個室A')) studios['個室A'] = 'occupied';
      if (title.includes('個室B')) studios['個室B'] = 'occupied';
    });

    const occupiedSlots = Object.values(studios).filter(s => s === 'occupied').length;
    const totalSlots = 2; // 恵比寿は2枠

    return createJsonResponse({
      store: 'ebisu',
      store_name: '恵比寿店',
      date: date,
      start_time: startTime,
      end_time: endTime,
      available: occupiedSlots < totalSlots,
      total_slots: totalSlots,
      occupied_slots: occupiedSlots,
      remaining_slots: totalSlots - occupiedSlots,
      studios: studios
    });

  } catch (error) {
    return createJsonResponse({
      error: error.toString()
    }, 500);
  }
}

function createJsonResponse(data, statusCode = 200) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
```

**デプロイ手順:**
1. GASエディタで「デプロイ」→「新しいデプロイ」
2. 種類: 「ウェブアプリ」
3. 実行ユーザー: 「自分」
4. アクセスできるユーザー: 「全員」
5. デプロイURLをメモ（統合フロントエンドで使用）

#### 渋谷店・代々木上原店・中目黒店（Flask）
`app.py` に追加:

```python
@app.route('/api/availability', methods=['GET'])
def check_availability():
    """空き状況取得API"""
    date = request.args.get('date')
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')
    store = request.args.get('store', 'shibuya')

    # バリデーション
    if not all([date, start_time, end_time]):
        return jsonify({'error': 'Missing required parameters'}), 400

    # 店舗ごとの最大枠数
    MAX_SLOTS = {
        'shibuya': 7,
        'yoyogiuehara': 2,
        'nakameguro': 1
    }

    max_slots = MAX_SLOTS.get(store, 1)

    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM reservations
                WHERE date = %s
                AND start_time = %s
                AND end_time = %s
                AND store = %s
            """, (date, start_time, end_time, store))

            occupied_slots = cur.fetchone()[0]
            remaining_slots = max_slots - occupied_slots

            return jsonify({
                'store': store,
                'store_name': f'{store}店',
                'date': date,
                'start_time': start_time,
                'end_time': end_time,
                'available': remaining_slots > 0,
                'total_slots': max_slots,
                'occupied_slots': occupied_slots,
                'remaining_slots': remaining_slots
            })
    finally:
        conn.close()
```

### Phase 3: 統合フロントエンド作成

新しいVercelプロジェクトを作成:

```bash
npx create-next-app@latest hallel-search
cd hallel-search
```

#### ディレクトリ構成
```
hallel-search/
├── pages/
│   ├── index.tsx           # メイン検索ページ
│   └── api/
│       └── search.ts       # バックエンドAPI（全店舗集約）
├── components/
│   ├── SearchForm.tsx      # 検索フォーム
│   ├── StoreCard.tsx       # 店舗カード表示
│   └── TimeSlotPicker.tsx  # 時間選択
├── lib/
│   └── stores.ts           # 店舗APIエンドポイント設定
└── public/
```

#### 主要コンポーネント

**pages/index.tsx**
```typescript
import { useState } from 'react';
import SearchForm from '@/components/SearchForm';
import StoreCard from '@/components/StoreCard';

export default function Home() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (date: string, startTime: string, endTime: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/search?date=${date}&start_time=${startTime}&end_time=${endTime}`);
      const data = await res.json();
      setResults(data.stores);
    } catch (error) {
      console.error('検索エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>HALLEL 空き状況検索</h1>
      <SearchForm onSearch={handleSearch} />

      {loading && <div>検索中...</div>}

      <div className="results">
        {results.map(store => (
          <StoreCard key={store.store} data={store} />
        ))}
      </div>
    </div>
  );
}
```

**pages/api/search.ts**
```typescript
import type { NextApiRequest, NextApiResponse } from 'next';

const STORE_APIS = {
  ebisu: 'https://script.google.com/macros/s/YOUR_EBISU_DEPLOY_ID/exec',
  hanzomon: 'https://script.google.com/macros/s/YOUR_HANZOMON_DEPLOY_ID/exec',
  shibuya: 'https://hallel.vercel.app/api/availability',
  yoyogiuehara: 'https://hallel-yoyogiuehara.vercel.app/api/availability',
  nakameguro: 'https://hallel-nakameguro.vercel.app/api/availability',
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { date, start_time, end_time } = req.query;

  try {
    const promises = Object.entries(STORE_APIS).map(async ([store, apiUrl]) => {
      const url = `${apiUrl}?date=${date}&start_time=${start_time}&end_time=${end_time}&store=${store}`;
      const response = await fetch(url);
      return response.json();
    });

    const stores = await Promise.all(promises);

    res.status(200).json({
      success: true,
      stores: stores,
      summary: {
        total_stores: stores.length,
        available_stores: stores.filter(s => s.available).length,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
}
```

**components/StoreCard.tsx**
```typescript
interface StoreCardProps {
  data: {
    store: string;
    store_name: string;
    available: boolean;
    remaining_slots: number;
    total_slots: number;
  };
}

export default function StoreCard({ data }: StoreCardProps) {
  const statusColor = data.available ? 'green' : 'red';
  const statusText = data.available
    ? `予約可能（残り${data.remaining_slots}枠）`
    : '満室';

  return (
    <div className={`store-card ${statusColor}`}>
      <h3>{data.store_name}</h3>
      <div className="status">{statusText}</div>
      <div className="capacity">
        {data.occupied_slots}/{data.total_slots}枠使用中
      </div>
      {data.available && (
        <button>この店舗で予約する</button>
      )}
    </div>
  );
}
```

### Phase 4: デプロイ・テスト

1. **Vercelにデプロイ**
   ```bash
   vercel --prod
   ```

2. **各店舗APIのURLを設定**
   - 環境変数に各店舗のAPIエンドポイントを設定

3. **E2Eテスト**
   - 全店舗の空き状況が正しく表示されるか確認
   - レスポンス速度の確認
   - エラーハンドリングの確認

---

## UI/UX設計

### メイン画面イメージ
```
┌────────────────────────────────────────┐
│  HALLEL 空き状況検索                    │
├────────────────────────────────────────┤
│                                        │
│  日付: [2025-12-01 ▼]                 │
│  開始時刻: [10:00 ▼]                  │
│  終了時刻: [12:00 ▼]                  │
│                                        │
│  [検索]                                │
│                                        │
├────────────────────────────────────────┤
│  検索結果: 5店舗中3店舗で予約可能       │
├────────────────────────────────────────┤
│                                        │
│  ┌──────────────┐  ┌──────────────┐  │
│  │ 恵比寿店 ✅  │  │ 半蔵門店 ✅  │  │
│  │ 残り1枠      │  │ 残り2枠      │  │
│  │ [予約する]   │  │ [予約する]   │  │
│  └──────────────┘  └──────────────┘  │
│                                        │
│  ┌──────────────┐  ┌──────────────┐  │
│  │ 渋谷店 ✅    │  │ 代々木上原❌ │  │
│  │ 残り3枠      │  │ 満室         │  │
│  │ [予約する]   │  │              │  │
│  └──────────────┘  └──────────────┘  │
│                                        │
│  ┌──────────────┐                    │
│  │ 中目黒店 ❌  │                    │
│  │ 満室         │                    │
│  │              │                    │
│  └──────────────┘                    │
└────────────────────────────────────────┘
```

### 機能
- ✅ リアルタイム空き状況表示
- ✅ 色分け（緑:空き、黄:残少、赤:満室）
- ✅ 残り枠数表示
- ✅ 代替店舗提案
- ✅ 直接予約へのリンク
- 📅 カレンダービュー（将来的に）
- 🔔 空き通知機能（将来的に）

---

## セキュリティ・パフォーマンス

### CORS設定
各店舗APIにCORSヘッダーを設定:
```javascript
// GAS
function doGet(e) {
  const output = createJsonResponse(data);
  output.setHeader('Access-Control-Allow-Origin', 'https://hallel-search.vercel.app');
  return output;
}
```

### キャッシュ戦略
- APIレスポンスを1分間キャッシュ
- 頻繁な更新を避け、各店舗APIの負荷を軽減

### レート制限
- 1ユーザーあたり1分間に10回まで検索可能

---

## 開発スケジュール

| Phase | タスク | 期限 |
|-------|--------|------|
| 1 | 代々木上原店システム作成 | TBD |
| 1 | 中目黒店システム作成 | TBD |
| 2 | 各店舗にAPI追加 | TBD |
| 3 | 統合フロントエンド実装 | TBD |
| 4 | テスト・デプロイ | TBD |

---

## 注意事項

1. **全店舗のシステムが完成してから実装開始**
2. **各店舗のAPI URLは環境変数で管理**
3. **GASのデプロイIDは必ずメモ**
4. **CORS設定を忘れずに**
5. **レート制限の監視（特にGmail API）**

---

## 関連ファイル

- `gas-ebisu-calendar-sync.js` - 恵比寿店GAS（API追加予定）
- `gas-hanzomon-calendar-sync.js` - 半蔵門店GAS（API追加予定）
- `app.py` - 渋谷・代々木上原・中目黒のFlaskアプリ（API追加予定）

---

**最終更新:** 2025-11-14
**ステータス:** 計画中（Phase 1進行中）
