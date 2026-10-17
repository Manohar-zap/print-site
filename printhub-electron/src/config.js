/**
 * src/config.js
 *
 * Centralised configuration for the Electron main process.
 *
 * In development: reads from a `.env` file in the project root.
 * In production (packaged): reads from process.env (set by the OS or a
 * companion `.env` file the installer places beside the app resources).
 *
 * NEVER commit real credentials. Use `.env.example` as a template.
 */
'use strict';

const path = require('path');
const fs   = require('fs');

// Load .env from project root during development
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://bqvcrsktjzivdvzodgab.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdmNyc2t0anppdmR2em9kZ2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NDU1MzYsImV4cCI6MjA5NDUyMTUzNn0.Jq0rWvAkDyRcNov67Y6b6XsUBlAZwkIoWATvPIbsAGc';

/**
 * Validate that required config values are present.
 * Returns an array of error strings (empty = OK).
 */
function validate() {
  const errors = [];
  if (!SUPABASE_URL)      errors.push('SUPABASE_URL is missing');
  if (!SUPABASE_ANON_KEY) errors.push('SUPABASE_ANON_KEY is missing');
  try {
    new URL(SUPABASE_URL);
  } catch {
    if (SUPABASE_URL) errors.push('SUPABASE_URL is not a valid URL');
  }
  return errors;
}

module.exports = { SUPABASE_URL, SUPABASE_ANON_KEY, validate };
