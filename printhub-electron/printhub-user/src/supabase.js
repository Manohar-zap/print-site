// src/supabase.js
const SUPABASE_URL = 'https://bqvcrsktjzivdvzodgab.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdmNyc2t0anppdmR2em9kZ2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NDU1MzYsImV4cCI6MjA5NDUyMTUzNn0.Jq0rWvAkDyRcNov67Y6b6XsUBlAZwkIoWATvPIbsAGc';

// We load Supabase from CDN — no npm needed
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

export default supabase;
