-- ============================================================
-- 八尾徳洲会総合病院 外部業者オリエンテーション管理システム
-- Supabase PostgreSQL スキーマ
-- ============================================================

-- 業者テーブル
CREATE TABLE vendors (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT NOT NULL,
  device      TEXT NOT NULL DEFAULT '脊椎インプラント全般',
  tel         TEXT,
  email       TEXT,
  note        TEXT,
  -- ログイン用（業者側アプリ）
  login_code  TEXT UNIQUE, -- 6桁英数字、病院が発行
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 受講記録テーブル
CREATE TABLE orientation_records (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id       UUID REFERENCES vendors(id) ON DELETE CASCADE,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry          DATE NOT NULL,
  -- 動画視聴
  watched_safety     BOOLEAN DEFAULT FALSE,
  watched_infection  BOOLEAN DEFAULT FALSE,
  watched_facility   BOOLEAN DEFAULT FALSE,
  watched_privacy    BOOLEAN DEFAULT FALSE,
  watched_all        BOOLEAN GENERATED ALWAYS AS (
    watched_safety AND watched_infection AND watched_facility AND watched_privacy
  ) STORED,
  -- チェックリスト（12項目をJSONで保存）
  checklist       JSONB DEFAULT '[]',
  -- テスト
  test_scores     JSONB DEFAULT '[]', -- [true,false,true,true,true]
  test_pass       BOOLEAN DEFAULT FALSE,
  -- 担当看護師
  staff_name      TEXT,
  -- 誓約書
  pledge_signed   BOOLEAN DEFAULT FALSE,
  pledge_name     TEXT,
  pledge_company  TEXT,
  pledge_signed_at TIMESTAMPTZ,
  pledge_sig_image TEXT, -- base64 PNG
  -- フラグ
  pledge_only     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 病院スタッフテーブル（管理者ログイン）
CREATE TABLE hospital_staff (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, -- bcrypt (Netlify Functionで処理)
  display_name TEXT,
  role        TEXT DEFAULT 'staff', -- 'admin' | 'staff'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- セッションテーブル（シンプルトークン管理）
CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL,
  user_type   TEXT NOT NULL, -- 'hospital' | 'vendor'
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE vendors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orientation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospital_staff     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;

-- anon (未認証) は一切アクセス不可
CREATE POLICY "deny_anon_vendors"   ON vendors            FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_records"   ON orientation_records FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_staff"     ON hospital_staff      FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_sessions"  ON sessions            FOR ALL TO anon USING (false);

-- service_role (Netlify Functions) は全アクセス可
CREATE POLICY "allow_service_vendors"  ON vendors            FOR ALL TO service_role USING (true);
CREATE POLICY "allow_service_records"  ON orientation_records FOR ALL TO service_role USING (true);
CREATE POLICY "allow_service_staff"    ON hospital_staff      FOR ALL TO service_role USING (true);
CREATE POLICY "allow_service_sessions" ON sessions            FOR ALL TO service_role USING (true);

-- ============================================================
-- 初期データ: 病院管理者アカウント
-- パスワード "hospital2026!" のbcryptハッシュ（Functions側で生成）
-- ============================================================
-- INSERT INTO hospital_staff (username, password_hash, display_name, role)
-- VALUES ('admin', '$2b$10$...', '手術室管理者', 'admin');

-- ============================================================
-- インデックス
-- ============================================================
CREATE INDEX idx_vendors_login_code ON vendors(login_code);
CREATE INDEX idx_records_vendor_id  ON orientation_records(vendor_id);
CREATE INDEX idx_records_expiry     ON orientation_records(expiry);
CREATE INDEX idx_sessions_token     ON sessions(token);
CREATE INDEX idx_sessions_expires   ON sessions(expires_at);

-- ============================================================
-- 期限切れセッション自動削除（pg_cron 推奨、なければ手動）
-- ============================================================
-- SELECT cron.schedule('delete-expired-sessions', '0 * * * *',
--   'DELETE FROM sessions WHERE expires_at < NOW()');
