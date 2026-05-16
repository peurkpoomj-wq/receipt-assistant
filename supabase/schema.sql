-- ============================================================
-- Receipt Bot — Multi-Tenant Schema
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Tenants ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      TEXT NOT NULL,

  -- LINE OA credentials
  line_channel_secret       TEXT NOT NULL,
  line_channel_access_token TEXT NOT NULL,

  -- Google OAuth2 (per-tenant)
  google_oauth_client_id     TEXT NOT NULL,
  google_oauth_client_secret TEXT NOT NULL,
  google_oauth_refresh_token TEXT NOT NULL,

  -- Google Sheets config
  spreadsheet_id  TEXT NOT NULL,
  sheet_name      TEXT NOT NULL DEFAULT 'Expenses',

  -- Tour group names (JSON array)
  tour_groups     JSONB NOT NULL DEFAULT '["กรุ๊ปญี่ปุ่น","กรุ๊ปเกาหลี","กรุ๊ปยุโรป","กรุ๊ปจีน","กรุ๊ปออสเตรเลีย"]',

  -- Plan & usage
  plan                  TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','business')),
  monthly_receipt_count INTEGER NOT NULL DEFAULT 0,
  monthly_reset_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Status
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Expenses (optional — for analytics, duplicate detection, reports) ─────────

CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  date            TEXT,
  merchant_name   TEXT,
  total_amount    NUMERIC(12, 2),
  category        TEXT,
  expense_type    TEXT,
  tour_group      TEXT DEFAULT '',
  line_message_id TEXT UNIQUE,   -- prevents duplicate processing
  line_user_id    TEXT,

  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_recorded ON expenses(tenant_id, recorded_at DESC);

-- ─── Helper RPC: increment_receipt_count ──────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_receipt_count(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Reset counter if a new month has started
  UPDATE tenants
  SET
    monthly_receipt_count = CASE
      WHEN date_trunc('month', monthly_reset_at) < date_trunc('month', NOW())
      THEN 1
      ELSE monthly_receipt_count + 1
    END,
    monthly_reset_at = CASE
      WHEN date_trunc('month', monthly_reset_at) < date_trunc('month', NOW())
      THEN NOW()
      ELSE monthly_reset_at
    END
  WHERE id = tenant_id;
END;
$$ LANGUAGE plpgsql;

-- ─── Row Level Security (optional — enable if you expose Supabase to clients) ──

-- ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- ─── Sample: insert your first tenant manually ────────────────────────────────
-- UPDATE the values below with your real credentials, then run in SQL Editor

/*
INSERT INTO tenants (
  name,
  line_channel_secret,
  line_channel_access_token,
  google_oauth_client_id,
  google_oauth_client_secret,
  google_oauth_refresh_token,
  spreadsheet_id,
  sheet_name,
  plan
) VALUES (
  'My Company',
  'YOUR_LINE_CHANNEL_SECRET',
  'YOUR_LINE_CHANNEL_ACCESS_TOKEN',
  'YOUR_GOOGLE_CLIENT_ID',
  'YOUR_GOOGLE_CLIENT_SECRET',
  'YOUR_GOOGLE_REFRESH_TOKEN',
  'YOUR_SPREADSHEET_ID',
  'Expenses',
  'business'
);
*/
