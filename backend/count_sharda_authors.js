/**
 * Fetch ALL 3,445 unique Sharda University authors via Author Search API.
 * 
 * Endpoint: /content/search/author?query=AF-ID(60108680)
 * Returns: Author ID, name, affiliation, subject areas, document count
 * 
 * At 25 per page = ~138 API calls. Quota remaining: ~4,600
 * Fully resumable.
 */
const axios = require('axios');
const fs = require('fs');
const { Parser } = require('json2csv');
require('dotenv').config();

const API_KEY = process.env.SCOPUS_API_KEY;
const PAGE_SIZE = 25;
const CACHE_FILE = 'sharda_authors_by_id.json';
const CSV_FILE = 'sharda_authors_by_id.csv';
const PROGRESS_FILE = 'author_scan_progress.json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Load progress for resumability
let scannedStart = 0;
let authorMap = {};
if (fs.existsSync(PROGRESS_FILE)) {
    const prog = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    scannedStart = prog.lastStart || 0;
    authorMap = prog.authors || {};
    console.log(`Resuming from start=${scannedStart}, ${Object.keys(authorMap).length} authors cached.`);
}

function saveProgress(start) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
        lastStart: start,
        authors: authorMap,
        savedAt: new Date().toISOString()
    }));
}

async function fetchPage(start) {
    const query = encodeURIComponent('AF-ID(60108680)');
    const url = `https://api.elsevier.com/content/search/author?query=${query}&start=${start}&count=${PAGE_SIZE}`;

    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const res = await axios.get(url, {
                headers: { 'X-ELS-APIKey': API_KEY, 'Accept': 'application/json' },
                timeout: 30000
            });
            return res;
        } catch (err) {
            const status = err.response?.status;
            if (status === 429) {
                const remaining = err.response?.headers?.['x-ratelimit-remaining'];
                const isExhausted = (remaining !== undefined && parseInt(remaining) === 0) ||
                                    (remaining === undefined);
                if (isExhausted) {
                    throw new Error('QUOTA_EXHAUSTED');
                }
                const wait = 2000 * Math.pow(2, attempt);
                console.log(`\n  [429] Burst limit. Retrying in ${wait}ms...`);
                await sleep(wait);
                continue;
            }
            if (attempt < 3 && (!status || status >= 500)) {
                await sleep(2000);
                continue;
            }
            throw err;
        }
    }
}

async function run() {
    console.log(`\n====================================================`);
    console.log(`  Fetching All Sharda Authors (by Author ID)`);
    console.log(`====================================================\n`);

    // First, get the total count
    const firstRes = await fetchPage(0);
    const totalResults = parseInt(firstRes.data['search-results']['opensearch:totalResults']);
    console.log(`📊 Total unique Sharda authors on Scopus: ${totalResults}`);
    console.log(`📡 Estimated API calls: ${Math.ceil(totalResults / PAGE_SIZE)}`);
    console.log(`   Quota remaining: ${firstRes.headers['x-ratelimit-remaining']}\n`);

    // Process first page if not already done
    if (scannedStart === 0) {
        processEntries(firstRes.data['search-results'].entry || []);
        scannedStart = PAGE_SIZE;
        saveProgress(scannedStart);
    }

    // Paginate through the rest
    for (let start = scannedStart; start < totalResults; start += PAGE_SIZE) {
        try {
            const res = await fetchPage(start);
            if (!res) break;

            const data = res.data['search-results'];
            const entries = data.entry || [];
            const remaining = res.headers['x-ratelimit-remaining'];

            if (entries.length === 0 || entries[0]?.error) break;

            processEntries(entries);

            const page = Math.floor(start / PAGE_SIZE) + 1;
            const totalPages = Math.ceil(totalResults / PAGE_SIZE);
            process.stdout.write(`\r  Page ${page}/${totalPages} | Authors: ${Object.keys(authorMap).length}/${totalResults} | Quota: ${remaining}  `);

            // Save progress every 5 pages
            if (page % 5 === 0) {
                saveProgress(start + PAGE_SIZE);
            }

            await sleep(300);
        } catch (err) {
            if (err.message === 'QUOTA_EXHAUSTED') {
                console.log(`\n\n⚠️  Quota exhausted! Progress saved. Re-run to continue.`);
                saveProgress(start);
                break;
            }
            console.error(`\nError at start=${start}:`, err.message);
        }
    }

    // Final save
    const authors = Object.values(authorMap);
    saveProgress(totalResults);

    console.log(`\n\n====================================================`);
    console.log(`  RESULTS`);
    console.log(`====================================================`);
    console.log(`  ✅ Unique Sharda authors fetched: ${authors.length}`);
    console.log(`====================================================\n`);

    // Save JSON
    fs.writeFileSync(CACHE_FILE, JSON.stringify(authors, null, 2));
    console.log(`  JSON saved: ${CACHE_FILE}`);

    // Save CSV
    if (authors.length > 0) {
        const fields = ['authorId', 'fullName', 'surname', 'givenName', 'documentCount', 
                         'university', 'city', 'country', 'topSubjectArea', 'orcid'];
        try {
            const parser = new Parser({ fields });
            fs.writeFileSync(CSV_FILE, parser.parse(authors));
            console.log(`  CSV saved: ${CSV_FILE}`);
        } catch (e) {
            console.error('CSV error:', e.message);
        }
    }

    console.log('');
}

function processEntries(entries) {
    for (const entry of entries) {
        const authorId = entry['dc:identifier']?.replace('AUTHOR_ID:', '') || '';
        if (!authorId || authorMap[authorId]) continue;

        const prefName = entry['preferred-name'] || {};
        const affCurrent = entry['affiliation-current'] || {};
        const subjects = entry['subject-area'] || [];
        const topSubject = Array.isArray(subjects) && subjects.length > 0
            ? subjects[0]['$'] || ''
            : '';

        authorMap[authorId] = {
            authorId,
            fullName: `${prefName['given-name'] || ''} ${prefName['surname'] || ''}`.trim(),
            surname: prefName['surname'] || '',
            givenName: prefName['given-name'] || '',
            documentCount: parseInt(entry['document-count'] || '0'),
            university: affCurrent['affiliation-name'] || 'Sharda University',
            city: affCurrent['affiliation-city'] || '',
            country: affCurrent['affiliation-country'] || '',
            topSubjectArea: topSubject,
            orcid: (entry['orcid'] || '').replace(/[\[\]]/g, ''),
            afid: affCurrent['affiliation-id'] || '60108680'
        };
    }
}

run().then(() => process.exit(0)).catch(err => {
    console.error('Fatal:', err.message);
    saveProgress(scannedStart);
    process.exit(1);
});
