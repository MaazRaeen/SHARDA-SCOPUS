/**
 * Map 3,407 Scopus authors to Sharda's 25 canonical departments
 * and sync to Supabase.
 */
const fs = require('fs');
const supabase = require('./config/db_supabase');
require('dotenv').config();

// ---- 25 Canonical Sharda Departments ----
const canonicalDepts = [
    "Department of Dental Science",
    "Department of Medical Sciences",
    "Department of Education",
    "Department of Pharmacy",
    "Department of Allied Health Science",
    "Department of Agricultural Science",
    "Department of Business and Commerce",
    "Department of Management",
    "Department of Chemistry and Biochemistry",
    "Department of Environmental Science",
    "Department of Life Sciences",
    "Department of Mathematics",
    "Department of Physics",
    "Department of Architecture",
    "Department of Art and Science",
    "Department of Biotechnology",
    "Department of Civil Engineering",
    "Department of Computer Science & Applications",
    "Department of Computer Science & Engineering",
    "Department of Electrical Electronics & Communication Engineering",
    "Department of Mechanical Engineering",
    "Department of Humanities & Social Sciences",
    "Department of Mass Communication",
    "Department of Nursing Sciences",
    "Department of Law"
];

// ---- Mapping: Scopus Subject Area → Sharda Department ----
const subjectToDept = {
    "Computer Science (all)": "Department of Computer Science & Engineering",
    "Medicine (all)": "Department of Medical Sciences",
    "Engineering (all)": "Department of Mechanical Engineering",
    "Materials Science (all)": "Department of Physics",
    "Biochemistry, Genetics and Molecular Biology (all)": "Department of Biotechnology",
    "Mathematics (all)": "Department of Mathematics",
    "Chemistry (all)": "Department of Chemistry and Biochemistry",
    "Physics and Astronomy (all)": "Department of Physics",
    "Pharmacology, Toxicology and Pharmaceutics (all)": "Department of Pharmacy",
    "Environmental Science (all)": "Department of Environmental Science",
    "Agricultural and Biological Sciences (all)": "Department of Agricultural Science",
    "Social Sciences (all)": "Department of Humanities & Social Sciences",
    "Energy (all)": "Department of Electrical Electronics & Communication Engineering",
    "Dentistry (all)": "Department of Dental Science",
    "Business, Management and Accounting (all)": "Department of Business and Commerce",
    "Decision Sciences (all)": "Department of Management",
    "Chemical Engineering (all)": "Department of Civil Engineering",
    "Immunology and Microbiology (all)": "Department of Life Sciences",
    "Economics, Econometrics and Finance (all)": "Department of Business and Commerce",
    "Multidisciplinary": "Department of Art and Science",
    "Arts and Humanities (all)": "Department of Humanities & Social Sciences",
    "Health Professions  (all)": "Department of Allied Health Science",
    "Nursing (all)": "Department of Nursing Sciences",
    "Neuroscience (all)": "Department of Medical Sciences",
    "Psychology (all)": "Department of Education",
    "Earth and Planetary Sciences (all)": "Department of Environmental Science"
};

function mapToDepartment(subjectArea) {
    if (!subjectArea) return "NA";
    return subjectToDept[subjectArea] || "NA";
}

async function run() {
    console.log('\n====================================================');
    console.log('  Mapping Authors to Sharda Departments & Syncing');
    console.log('====================================================\n');

    // Load authors
    const authors = JSON.parse(fs.readFileSync('./sharda_authors_by_id.json', 'utf-8'));
    console.log(`📂 Loaded ${authors.length} authors\n`);

    // Map each author to a department
    const mappedAuthors = authors.map(a => ({
        ...a,
        department: mapToDepartment(a.topSubjectArea)
    }));

    // Show mapping stats
    const deptCounts = {};
    mappedAuthors.forEach(a => {
        deptCounts[a.department] = (deptCounts[a.department] || 0) + 1;
    });

    console.log('📊 Department Mapping Results:');
    console.log('-'.repeat(60));
    let total = 0;
    Object.entries(deptCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([dept, count]) => {
            console.log(`  ${count.toString().padStart(4)} | ${dept}`);
            total += count;
        });
    console.log('-'.repeat(60));
    console.log(`  ${total.toString().padStart(4)} | TOTAL`);
    console.log(`  Departments used: ${Object.keys(deptCounts).length}`);

    // -------------------------------------------------------
    // STEP 1: Clear and re-insert department_authors
    // -------------------------------------------------------
    console.log('\n--- Step 1: Syncing department_authors ---');

    // Clear existing data
    const { error: delErr } = await supabase.from('department_authors').delete().neq('id', 0);
    if (delErr) {
        console.log('  Delete error:', delErr.message);
        // Try alternative
        await supabase.from('department_authors').delete().gte('id', 0);
    }

    // Insert in batches
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < mappedAuthors.length; i += BATCH) {
        const batch = mappedAuthors.slice(i, i + BATCH).map(a => ({
            department: a.department,
            name: a.fullName,
            scopus_id: a.authorId,
            paper_count: a.documentCount,
            last_updated: new Date().toISOString()
        }));

        const { error } = await supabase.from('department_authors').insert(batch);
        if (error) {
            console.log(`  Insert error at ${i}:`, error.message);
            continue;
        }
        inserted += batch.length;
        process.stdout.write(`\r  Inserted ${inserted}/${mappedAuthors.length}`);
    }
    console.log(`\n  ✅ department_authors: ${inserted} rows`);

    // -------------------------------------------------------
    // STEP 2: Rebuild department_api_stats
    // -------------------------------------------------------
    console.log('\n--- Step 2: Rebuilding department_api_stats ---');

    // Clear old stats
    await supabase.from('department_api_stats').delete().neq('id', 0);

    // Aggregate
    const deptAgg = {};
    mappedAuthors.forEach(a => {
        const dept = a.department;
        if (!deptAgg[dept]) {
            deptAgg[dept] = { authors: [], totalPapers: 0 };
        }
        deptAgg[dept].authors.push(a);
        deptAgg[dept].totalPapers += a.documentCount;
    });

    const statsRows = Object.entries(deptAgg).map(([dept, data]) => {
        const topAuthor = data.authors.sort((a, b) => b.documentCount - a.documentCount)[0];
        return {
            department: dept,
            author_count: data.authors.length,
            total_papers: data.totalPapers,
            top_author_name: topAuthor?.fullName || 'N/A',
            top_author_papers: topAuthor?.documentCount || 0,
            last_updated: new Date().toISOString()
        };
    });

    const { error: statsErr } = await supabase.from('department_api_stats').upsert(statsRows, { onConflict: 'department' });
    if (statsErr) {
        console.log('  Stats error:', statsErr.message);
    } else {
        console.log(`  ✅ department_api_stats: ${statsRows.length} departments`);
    }

    // -------------------------------------------------------
    // STEP 3: Verify
    // -------------------------------------------------------
    console.log('\n--- Step 3: Verification ---');

    const { count: authCount } = await supabase.from('department_authors').select('*', { count: 'exact', head: true });
    const { count: statsCount } = await supabase.from('department_api_stats').select('*', { count: 'exact', head: true });

    console.log(`  department_authors: ${authCount} rows`);
    console.log(`  department_api_stats: ${statsCount} departments`);

    // Show final department summary from Supabase
    const { data: stats } = await supabase.from('department_api_stats').select('*').order('author_count', { ascending: false });
    console.log('\n📊 Final Department Stats in Supabase:');
    console.log('-'.repeat(70));
    console.log('  Authors | Papers | Department');
    console.log('-'.repeat(70));
    let totalAuthors = 0, totalPapers = 0;
    stats.forEach(s => {
        console.log(`  ${s.author_count.toString().padStart(6)} | ${s.total_papers.toString().padStart(6)} | ${s.department}`);
        totalAuthors += s.author_count;
        totalPapers += s.total_papers;
    });
    console.log('-'.repeat(70));
    console.log(`  ${totalAuthors.toString().padStart(6)} | ${totalPapers.toString().padStart(6)} | TOTAL`);

    console.log('\n====================================================');
    console.log('  ✅ Sync Complete!');
    console.log('====================================================\n');
}

run().then(() => process.exit(0)).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
