# 外部業者オリエンテーション管理システム
## セットアップ・デプロイ手順書

---

## ファイル構成

```
ori-system/
├── netlify.toml              Netlify設定
├── package.json              依存パッケージ
├── supabase_schema.sql       データベーススキーマ
├── hospital/
│   └── index.html            病院側管理アプリ
├── vendor/
│   └── index.html            業者側アプリ（動画内蔵）
└── netlify/
    └── functions/
        └── api.js            APIサーバー（認証+CRUD）
```

---

## STEP 1: Supabase セットアップ（約10分）

### 1-1. プロジェクト作成
1. https://supabase.com にアクセス → 「Start your project」
2. 「New Project」→ プロジェクト名：`ytgh-orientation`
3. データベースパスワードをメモ → 「Create new project」

### 1-2. テーブル作成
1. 左メニュー「SQL Editor」→「New query」
2. `supabase_schema.sql` の内容をすべてコピーして貼り付け → 「Run」

### 1-3. 管理者アカウント作成
SQL Editorで以下を実行（パスワードは変更してください）：

```sql
-- パスワード "ytgh-hospital-2026!" でアカウント作成
-- ※ sha256ハッシュ化はNetlify Function側で行うため、
--    以下のコマンドでハッシュを生成してから挿入してください
```

Node.jsで事前にハッシュ生成：
```js
const crypto = require('crypto');
const hash = crypto.createHmac('sha256', 'ytgh-secret')
                   .update('your-password').digest('hex');
console.log(hash);
```

SQL Editorで挿入：
```sql
INSERT INTO hospital_staff (username, password_hash, display_name, role)
VALUES ('admin', 'ここにハッシュを貼り付け', '手術室管理者', 'admin');
```

### 1-4. APIキー取得
1. 左メニュー「Settings」→「API」
2. 以下をメモ：
   - **Project URL**（例：`https://xxxx.supabase.co`）
   - **service_role key**（長いキー）

---

## STEP 2: Netlify デプロイ（約10分）

### 2-1. GitHubにプッシュ
```bash
cd ori-system
git init
git add .
git commit -m "initial deploy"
git remote add origin https://github.com/あなたのユーザー名/ytgh-orientation.git
git push -u origin main
```

### 2-2. Netlifyにデプロイ
1. https://netlify.com → 「Add new site」→「Import an existing project」
2. GitHubと連携 → リポジトリを選択
3. 設定はそのまま（netlify.tomlが自動読み込み）→「Deploy site」

### 2-3. 環境変数を設定
Netlifyダッシュボード → Site settings → Environment variables → Add variable

| 変数名 | 値 |
|--------|-----|
| `SUPABASE_URL` | SupabaseのProject URL |
| `SUPABASE_SERVICE_KEY` | Supabaseのservice_role key |
| `JWT_SECRET` | 任意のランダム文字列（例：`ytgh-2026-secret-key-xxxxx`）|

→「Save」→ Deployをトリガー（Deploys → Trigger deploy → Deploy site）

---

## STEP 3: 動作確認

### アクセスURL
| 用途 | URL |
|------|-----|
| 病院側アプリ | `https://あなたのサイト.netlify.app/hospital` |
| 業者側アプリ | `https://あなたのサイト.netlify.app/vendor` |

### 病院側ログイン
- ユーザー名：`admin`
- パスワード：STEP 1-3で設定したもの

### 業者登録 → ログインコード発行の流れ
1. 病院側アプリにログイン
2. 「業者管理」→「業者を登録」→ 登録完了時に6桁コードが表示される
3. そのコードを業者に伝える
4. 業者は `/vendor` にアクセスして6桁コードを入力

---

## STEP 4: スマートフォン対応

両アプリともスマートフォン・タブレット対応済みです。

**推奨ブラウザ：**
- iPhone：Safari
- Android：Chrome
- タブレット：Safari / Chrome

**iPadでの電子署名：**
- 業者側アプリの誓約書の署名パッドはタッチ対応
- Apple Pencilも使用可能

---

## 運用フロー

```
【病院側】                    【業者側】
業者を登録                        ↓
  ↓                         6桁コードでログイン
ログインコードを業者に伝える          ↓
  ↓                         動画視聴（4章）
当日確認タブで受講状態を確認          ↓
  ↓                         チェックリスト確認
受講記録タブで履歴確認               ↓
                             理解度テスト（5問）
                                  ↓
                             電子誓約書署名
                                  ↓
                             受講証表示
```

---

## セキュリティについて

- すべての通信はHTTPS（Netlify標準）
- パスワードはHMAC-SHA256でハッシュ化
- セッショントークンはランダム64文字
- Row Level Security（RLS）でDBを保護
- 業者は自分の情報のみアクセス可（service_role keyはサーバー側のみ）

---

## カスタマイズ

### 病院名・連絡先を変更
`hospital/index.html` と `vendor/index.html` 内のテキストを検索・置換

### パスワードのポリシー変更
`netlify/functions/api.js` の `hashPass()` 関数を修正

### 有効期限を1年以外に変更
`netlify/functions/api.js` の `/my/test` エンドポイント内
```js
const expiry = new Date(new Date().setFullYear(new Date().getFullYear()+1))...
```
の `+1` を変更

---

## サポート・問い合わせ

システム作成：八鍬　貴則（手術室 / 株式会社八龍商店）
文書番号：YTGH-ASC-04.04-SYS-01
