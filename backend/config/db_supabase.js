const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = 'https://fyzesotbpwgcrqjveuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5emVzb3RicHdnY3JxanZldXhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA5NTg5OCwiZXhwIjoyMDkwNjcxODk4fQ.6g4JtxUeChQqGFNDVnDp_dDF4nvipzV-CinrBqxI-iY';

/**
 * Supabase Client for HTTP-based data management
 * Using SERVICE_ROLE key to bypass RLS for administrative sync
 */
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
