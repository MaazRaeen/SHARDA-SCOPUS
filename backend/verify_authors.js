const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://fyzesotbpwgcrqjveuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5emVzb3RicHdnY3JxanZldXhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA5NTg5OCwiZXhwIjoyMDkwNjcxODk4fQ.6g4JtxUeChQqGFNDVnDp_dDF4nvipzV-CinrBqxI-iY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTotalAuthors() {
    const { data, error } = await supabase
        .from('department_api_stats')
        .select('author_count')
        .neq('department', '[INSTITUTIONAL_CORE]');

    if (error) {
        console.error("Error:", error.message);
    } else {
        const total = data.reduce((acc, row) => acc + (row.author_count || 0), 0);
        console.log("Total Authors across departments:", total);
    }
}

checkTotalAuthors();
