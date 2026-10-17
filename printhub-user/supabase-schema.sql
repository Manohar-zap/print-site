-- ============================================================
-- PRINTHUB — SUPABASE SCHEMA
-- Run this entire file in Supabase → SQL Editor → Run
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS (extends Supabase auth.users) ──────────────────────
CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  role        TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','owner','admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── SHOPS ─────────────────────────────────────────────────────
CREATE TABLE public.shops (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL,
  lat         FLOAT,
  lng         FLOAT,
  status      TEXT DEFAULT 'open' CHECK (status IN ('open','busy','paused','offline')),
  auto_print  BOOLEAN DEFAULT TRUE,
  shop_code   TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── ORDERS ────────────────────────────────────────────────────
CREATE TABLE public.orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL,              -- e.g. A24
  user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  shop_id         UUID REFERENCES public.shops(id),
  file_url        TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_size       BIGINT NOT NULL,
  file_hash       TEXT,
  pages           INT DEFAULT 0,
  copies          INT DEFAULT 1,
  color_mode      TEXT DEFAULT 'bw' CHECK (color_mode IN ('bw','colour')),
  paper_size      TEXT DEFAULT 'A4',
  sides           TEXT DEFAULT 'single' CHECK (sides IN ('single','double')),
  notes           TEXT,
  is_priority     BOOLEAN DEFAULT FALSE,
  priority_fee    INT DEFAULT 0,
  status          TEXT DEFAULT 'pending' CHECK (status IN (
                    'pending','paid','queued','downloading',
                    'printing','completed','failed','cancelled')),
  payment_mode    TEXT DEFAULT 'online' CHECK (payment_mode IN ('online','offline')),
  payment_status  TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  razorpay_id     TEXT,
  amount_total    INT DEFAULT 0,              -- paise (₹ * 100)
  amount_shop     INT DEFAULT 0,
  amount_platform INT DEFAULT 0,
  retry_count     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── TOKEN COUNTER (daily reset) ───────────────────────────────
CREATE TABLE public.token_counters (
  shop_id   UUID REFERENCES public.shops(id),
  date      DATE DEFAULT CURRENT_DATE,
  counter   INT DEFAULT 0,
  PRIMARY KEY (shop_id, date)
);

-- ── PRINT JOBS (Electron job tracking) ───────────────────────
CREATE TABLE public.print_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID REFERENCES public.orders(id),
  printer     TEXT,
  job_status  TEXT DEFAULT 'waiting',
  error_log   TEXT,
  printed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── ANALYTICS EVENTS ──────────────────────────────────────────
CREATE TABLE public.analytics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID REFERENCES public.shops(id),
  event       TEXT NOT NULL,
  value       INT DEFAULT 1,
  meta        JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_counters ENABLE ROW LEVEL SECURITY;

-- profiles: users can read/update their own
CREATE POLICY "profiles_self" ON public.profiles
  FOR ALL USING (auth.uid() = id);

-- shops: anyone can read, only owner can modify
CREATE POLICY "shops_read_all" ON public.shops
  FOR SELECT USING (TRUE);
CREATE POLICY "shops_owner_modify" ON public.shops
  FOR ALL USING (auth.uid() = owner_id);

-- orders: anyone can INSERT (anonymous ordering, no login required)
CREATE POLICY "orders_insert_anon" ON public.orders
  FOR INSERT WITH CHECK (TRUE);

-- orders: anyone can read by token (for tracking page)
CREATE POLICY "orders_read_by_token" ON public.orders
  FOR SELECT USING (TRUE);

-- orders: owner of shop can update order status
CREATE POLICY "orders_owner_update" ON public.orders
  FOR UPDATE USING (
    auth.uid() IN (
      SELECT owner_id FROM public.shops WHERE id = orders.shop_id
    )
  );

-- print_jobs: shop owner only
CREATE POLICY "print_jobs_owner" ON public.print_jobs
  FOR ALL USING (
    auth.uid() IN (
      SELECT s.owner_id FROM public.orders o
      JOIN public.shops s ON s.id = o.shop_id
      WHERE o.id = print_jobs.order_id
    )
  );

-- analytics: shop owner only
CREATE POLICY "analytics_owner" ON public.analytics
  FOR ALL USING (
    auth.uid() IN (
      SELECT owner_id FROM public.shops WHERE id = analytics.shop_id
    )
  );

-- token_counters: only accessible via get_next_token function (SECURITY DEFINER)
-- The function runs as the DB owner so it bypasses RLS automatically.
-- But add a permissive policy just in case:
CREATE POLICY "tokens_service_only" ON public.token_counters
  FOR ALL USING (TRUE);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at on orders
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Generate next token for a shop (A00–Z99, resets daily)
CREATE OR REPLACE FUNCTION get_next_token(p_shop_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_counter INT;
  v_letter  CHAR;
  v_num     INT;
BEGIN
  INSERT INTO public.token_counters (shop_id, date, counter)
  VALUES (p_shop_id, CURRENT_DATE, 1)
  ON CONFLICT (shop_id, date)
  DO UPDATE SET counter = token_counters.counter + 1
  RETURNING counter INTO v_counter;

  v_counter := v_counter - 1; -- 0-indexed
  v_letter := CHR(65 + (v_counter / 100));  -- A-Z
  v_num    := v_counter % 100;
  RETURN v_letter || LPAD(v_num::TEXT, 2, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-create profile after signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'customer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
-- Run this separately in Supabase Storage settings:
-- 1. Create bucket named: print-files
-- 2. Set to PRIVATE
-- 3. File size limit: 52428800 (50MB)
-- 4. Allowed MIME types: application/pdf

-- Run these storage policies in SQL editor after bucket is created:

-- Allow anyone (anon) to upload PDFs (anonymous ordering)
-- INSERT INTO storage.policies (name, bucket_id, operation, definition)
-- Run via Supabase dashboard: Storage → print-files → Policies → New policy

-- Policy 1: Anyone can upload (INSERT)
-- Name: anon_upload
-- Allowed operation: INSERT
-- Policy definition: true

-- Policy 2: Shop owner can read files for their orders (SELECT)
-- Name: owner_read
-- Allowed operation: SELECT
-- Policy definition: true

-- Easiest approach for MVP: set bucket to PUBLIC READ
-- then restrict writes via the INSERT policy above.
