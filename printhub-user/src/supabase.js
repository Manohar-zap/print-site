// src/supabase.js
// Read Supabase config from `window.__ENV` injected via env.js (not committed)
const SUPABASE_URL = (typeof window !== 'undefined' && window.__ENV && window.__ENV.SUPABASE_URL) ? window.__ENV.SUPABASE_URL : '';
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.__ENV && window.__ENV.SUPABASE_ANON_KEY) ? window.__ENV.SUPABASE_ANON_KEY : '';

// We load Supabase from CDN — no npm needed
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

export default supabase;
