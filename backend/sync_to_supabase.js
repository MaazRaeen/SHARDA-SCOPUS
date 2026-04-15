/**
 * Final sync: Map 3,407 authors + API paper counts to 25 departments in Supabase.
 * Paper counts come from Scopus API SUBJAREA queries.
 * If a paper belongs to multiple departments, it counts in all of them.
 */
const fs = require('fs');
const axios = require('axios');
const supabase = require('./config/db_supabase');
require('dotenv').config();

const API_KEY = process.env.SCOPUS_API_KEY;
const HEADERS = { 'X-ELS-APIKey': API_KEY, 'Accept': 'application/json' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- 25 Canonical Departments ----
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

// ---- Scopus Subject Area → Department mapping ----
// Multiple subject codes can map to the same department (papers merge)
const subjectToDeptMapping = [
    { code: "COMP", dept: "Department of Computer Science & Engineering" },
    { code: "MEDI", dept: "Department of Medical Sciences" },
    { code: "ENGI", dept: "Department of Mechanical Engineering" },
    { code: "MATE", dept: "Department of Physics" },
    { code: "PHYS", dept: "Department of Physics" },
    { code: "BIOC", dept: "Department of Biotechnology" },
    { code: "MATH", dept: "Department of Mathematics" },
    { code: "CHEM", dept: "Department of Chemistry and Biochemistry" },
    { code: "PHAR", dept: "Department of Pharmacy" },
    { code: "ENVI", dept: "Department of Environmental Science" },
    { code: "AGRI", dept: "Department of Agricultural Science" },
    { code: "SOCI", dept: "Department of Humanities & Social Sciences" },
    { code: "ENER", dept: "Department of Electrical Electronics & Communication Engineering" },
    { code: "DENT", dept: "Department of Dental Science" },
    { code: "BUSI", dept: "Department of Business and Commerce" },
    { code: "DECI", dept: "Department of Management" },
    { code: "EART", dept: "Department of Environmental Science" },
    { code: "CENG", dept: "Department of Civil Engineering" },
    { code: "IMMU", dept: "Department of Life Sciences" },
    { code: "ECON", dept: "Department of Business and Commerce" },
    { code: "MULT", dept: "Department of Art and Science" },
    { code: "ARTS", dept: "Department of Humanities & Social Sciences" },
    { code: "HEAL", dept: "Department of Allied Health Science" },
    { code: "NURS", dept: "Department of Nursing Sciences" },
    { code: "NEUR", dept: "Department of Medical Sciences" },
    { code: "PSYC", dept: "Department of Education" },
    { code: "VETE", dept: "Department of Agricultural Science" }
];

// Author subject area text → Department (for author mapping)
const authorSubjectToDept = {
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

// For departments with multiple subject codes, we need unique paper count.
// Use combined SUBJAREA query: SUBJAREA(CODE1) OR SUBJAREA(CODE2)
// This way Scopus deduplicates papers that belong to both codes.
const deptToSubjectCodes = {};
subjectToDeptMapping.forEach(({ code, dept }) => {
    if (!deptToSubjectCodes[dept]) deptToSubjectCodes[dept] = [];
    deptToSubjectCodes[dept].push(code);
});

async function fetchPaperCount(dept, codes) {
    const subjareaQuery = codes.map(c => `SUBJAREA(${c})`).join(' OR ');
    const fullQuery = `AF-ID(60108680) AND (${subjareaQuery})`;
    const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(fullQuery)}&count=1`;
    
    try {
        const res = await axios.get(url, { headers: HEADERS, timeout: 30000 });
        return parseInt(res.data['search-results']['opensearch:totalResults'] || '0');
    } catch (err) {
        console.log(`  ⚠️  Error for ${dept}: ${err.response?.status || err.message}`);
        return 0;
    }
}

async function run() {
    console.log('\n====================================================');
    console.log('  Mapping Papers & Authors to Departments');  
    console.log('  (Fetching real counts from Scopus API)');
    console.log('====================================================\n');

    // ---- Step 1: Fetch unique paper counts per department from API ----
    console.log('--- Step 1: Fetching paper counts from Scopus API ---');
    
    const deptPaperCounts = {};
    
    for (const [dept, codes] of Object.entries(deptToSubjectCodes)) {
        const count = await fetchPaperCount(dept, codes);
        deptPaperCounts[dept] = count;
        console.log(`  ${count.toString().padStart(5)} papers | ${dept} (${codes.join(', ')})`);
        await sleep(200);
    }

    // Get total unique papers
    const totalUrl = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent('AF-ID(60108680)')}&count=1`;
    const totalRes = await axios.get(totalUrl, { headers: HEADERS });
    const totalPapers = parseInt(totalRes.data['search-results']['opensearch:totalResults']);
    console.log(`\n  Total unique Sharda papers: ${totalPapers}`);
    console.log(`  Quota remaining: ${totalRes.headers['x-ratelimit-remaining']}\n`);

    // ---- Step 2: Map 3,407 authors to departments ----
    console.log('--- Step 2: Mapping authors to departments ---');
    const authors = JSON.parse(fs.readFileSync('./sharda_authors_by_id.json', 'utf-8'));
    
    const mappedAuthors = authors.map(a => ({
        ...a,
        department: authorSubjectToDept[a.topSubjectArea] || 'NA'
    }));

    // Count authors per department
    const deptAuthorCounts = {};
    mappedAuthors.forEach(a => {
        deptAuthorCounts[a.department] = (deptAuthorCounts[a.department] || 0) + 1;
    });
    console.log(`  ✅ ${authors.length} authors mapped\n`);

    // ---- Step 3: Sync department_authors to Supabase ----
    console.log('--- Step 3: Syncing department_authors ---');
    await supabase.from('department_authors').delete().neq('id', 0);

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
        if (error) { console.log(`  Error at ${i}:`, error.message); continue; }
        inserted += batch.length;
        process.stdout.write(`\r  Inserted ${inserted}/${mappedAuthors.length}`);
    }
    console.log(`\n  ✅ department_authors: ${inserted} rows\n`);

    // ---- Step 4: Rebuild department_api_stats with API paper counts ----
    console.log('--- Step 4: Rebuilding department_api_stats ---');
    await supabase.from('department_api_stats').delete().neq('id', 0);

    const allDepts = [...canonicalDepts, 'NA'];
    const statsRows = allDepts.map(dept => {
        const authorCount = deptAuthorCounts[dept] || 0;
        const paperCount = deptPaperCounts[dept] || 0;

        // Find top author in this department
        const deptAuthors = mappedAuthors
            .filter(a => a.department === dept)
            .sort((a, b) => b.documentCount - a.documentCount);
        const topAuthor = deptAuthors[0];

        return {
            department: dept,
            author_count: authorCount,
            total_papers: paperCount,
            top_author_name: topAuthor?.fullName || 'N/A',
            top_author_papers: topAuthor?.documentCount || 0,
            last_updated: new Date().toISOString()
        };
    }).filter(s => s.author_count > 0 || s.total_papers > 0);

    const { error: statsErr } = await supabase.from('department_api_stats').insert(statsRows);
    if (statsErr) {
        console.log('  Stats error:', statsErr.message);
    } else {
        console.log(`  ✅ department_api_stats: ${statsRows.length} departments\n`);
    }

    // ---- Step 5: Final Report ----
    console.log('='.repeat(75));
    console.log('  FINAL DEPARTMENT REPORT (All from Scopus API)');
    console.log('='.repeat(75));
    console.log('  Papers | Authors | Department');
    console.log('-'.repeat(75));

    let sumPapers = 0, sumAuthors = 0;
    const { data: finalStats } = await supabase.from('department_api_stats')
        .select('*').order('total_papers', { ascending: false });
    
    finalStats.forEach(s => {
        console.log(
            `  ${s.total_papers.toString().padStart(6)} | ${s.author_count.toString().padStart(7)} | ${s.department}`
        );
        sumPapers += s.total_papers;
        sumAuthors += s.author_count;
    });
    console.log('-'.repeat(75));
    console.log(`  ${sumPapers.toString().padStart(6)} | ${sumAuthors.toString().padStart(7)} | SUM (papers counted in multiple depts)`);
    console.log(`  ${totalPapers.toString().padStart(6)} |         | UNIQUE PAPERS (no overlap)`);
    console.log('='.repeat(75));
    console.log('\n  ✅ All done! Refresh your frontend.\n');
}

run().then(() => process.exit(0)).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
