const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://fyzesotbpwgcrqjveuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5emVzb3RicHdnY3JxanZldXhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA5NTg5OCwiZXhwIjoyMDkwNjcxODk4fQ.6g4JtxUeChQqGFNDVnDp_dDF4nvipzV-CinrBqxI-iY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDepartments() {
    const { data, error } = await supabase
        .from('department_api_stats')
        .select('department, author_count, total_papers')
        .neq('department', '[INSTITUTIONAL_CORE]')
        .order('total_papers', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error:", error.message);
    } else {
        console.log("Top 10 Departments:");
        console.table(data);
    }
}

checkDepartments();
