const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const path = require('path');
const { Parser } = require('json2csv');
require('dotenv').config();

const API_KEY = process.env.SCOPUS_API_KEY;
const SHARDA_AFID = '60108680';
const CACHE_FILE = 'scopus_cache.json';
const FAILED_FILE = 'scopus_failed.json';
const OUTPUT_FILE = 'sharda_authors_output.json';
const CSV_OUTPUT_FILE = 'sharda_authors_output.csv';

// ---- Load Cache (maps authorId -> { isSharda, fullName, ... } or { isSharda: false }) ----
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
}

// ---- Load Failed IDs ----
let failedIds = {};
if (fs.existsSync(FAILED_FILE)) {
    failedIds = JSON.parse(fs.readFileSync(FAILED_FILE, 'utf-8'));
}

let quotaExhausted = false;

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
function saveFailed() {
    fs.writeFileSync(FAILED_FILE, JSON.stringify(failedIds, null, 2));
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//  STRATEGY: Use Scopus SEARCH API (20,000 quota, authorized)
//  instead of Author Retrieval API (5,000 quota, 401 blocked)
//
//  For each author ID, we query:
//    AU-ID(xxxxx) AND AFFIL("Sharda")
//  If totalResults > 0, the author has published with Sharda.
//
//  We batch 25 author IDs per request using OR:
//    (AU-ID(id1) OR AU-ID(id2) OR ...) AND AFFIL("Sharda")
//  This reduces 18,840 checks to ~756 API calls!
// ============================================================

async function fetchWithRetry(url, headers, retries = 5, delay = 2000) {
    try {
        const response = await axios.get(url, { headers, timeout: 30000 });
        return response;
    } catch (err) {
        const status = err.response?.status;
        if (status === 429) {
            const h = err.response.headers;
            const remaining = h["x-ratelimit-remaining"];
            const reset = h["x-ratelimit-reset"];

            console.log(`\n[429] Remaining: ${remaining} | Reset: ${reset}`);

            const isExhausted = (remaining !== undefined && parseInt(remaining) === 0) ||
                                (remaining === undefined && reset === undefined);

            if (isExhausted) {
                let waitHours = 'unknown';
                if (reset) {
                    const waitSec = parseInt(reset) - Math.floor(Date.now() / 1000);
                    waitHours = (waitSec / 3600).toFixed(1);
                }
                console.log(`\n╔══════════════════════════════════════════════════════╗`);
                console.log(`║  API QUOTA EXHAUSTED — Saving progress & exiting     ║`);
                console.log(`║  Resets in ~${waitHours} hours                              ║`);
                console.log(`║  👉 Just re-run the same command to resume!          ║`);
                console.log(`╚══════════════════════════════════════════════════════╝\n`);
                quotaExhausted = true;
                throw new Error("QUOTA_EXHAUSTED");
            }

            if (retries > 0) {
                const retryAfter = h["retry-after"];
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay;
                console.log(`[429] Burst limit. Retrying in ${waitTime}ms... (${retries} left)`);
                await sleep(waitTime);
                return fetchWithRetry(url, headers, retries - 1, delay * 2);
            }
        }

        if (status === 401) throw new Error('Unauthorized');

        if (retries > 0 && (!status || status >= 500)) {
            await sleep(delay);
            return fetchWithRetry(url, headers, retries - 1, delay * 2);
        }

        console.error(`Failed: ${url} | Status: ${status || err.message}`);
        return null;
    }
}

/**
 * Check a batch of author IDs against Sharda affiliation.
 * Returns a Set of author IDs that ARE affiliated with Sharda.
 */
async function checkBatchSharda(authorIds) {
    // Build query: (AU-ID(id1) OR AU-ID(id2) OR ...) AND AFFIL("Sharda")
    const auQuery = authorIds.map(id => `AU-ID(${id})`).join(' OR ');
    const fullQuery = `(${auQuery}) AND AFFIL("Sharda University")`;
    const headers = { 'X-ELS-APIKey': API_KEY, 'Accept': 'application/json' };

    const shardaAuthorIds = new Set();

    // Paginate through all results (each paper may have multiple authors)
    let start = 0;
    const count = 25;
    let totalResults = 1; // will be updated

    while (start < totalResults) {
        const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(fullQuery)}&start=${start}&count=${count}`;
        const res = await fetchWithRetry(url, headers);
        if (!res) break;

        const data = res.data['search-results'];
        totalResults = parseInt(data['opensearch:totalResults'] || '0');
        const entries = data.entry || [];

        if (totalResults === 0 || (entries.length === 1 && entries[0].error)) break;

        for (const entry of entries) {
            // Each paper has an author list — match our queried IDs
            const authors = entry.author || [];
            for (const a of authors) {
                const authid = a.authid;
                if (authid && authorIds.includes(authid)) {
                    // Check if this paper has Sharda in its affiliations
                    const affs = entry.affiliation || [];
                    const hasSharda = affs.some(aff =>
                        (aff.affilname || '').toLowerCase().includes('sharda') ||
                        aff.afid === SHARDA_AFID
                    );
                    if (hasSharda) {
                        shardaAuthorIds.add(authid);
                        // Save author details
                        if (!cache[authid]) {
                            const shardaAff = affs.find(aff => (aff.affilname || '').toLowerCase().includes('sharda'));
                            cache[authid] = {
                                authorId: authid,
                                fullName: a.authname || 'Unknown',
                                university: shardaAff?.affilname || 'Sharda University',
                                department: '', // Search API doesn't provide department
                                city: shardaAff?.['affiliation-city'] || 'Greater Noida',
                                country: shardaAff?.['affiliation-country'] || 'India',
                                afid: shardaAff?.afid || SHARDA_AFID,
                                isSharda: true
                            };
                        }
                    }
                }
            }
        }

        start += count;

        // Safety: don't paginate more than 5 pages per batch (125 results should be enough)
        if (start > 125) break;
    }

    // Mark non-Sharda authors in cache so we skip them next time
    for (const id of authorIds) {
        if (!shardaAuthorIds.has(id) && !cache[id]) {
            cache[id] = { authorId: id, isSharda: false };
        }
    }

    return shardaAuthorIds;
}

function saveResults(results) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    if (results.length > 0) {
        const fields = ['fullName', 'authorId', 'university', 'department', 'city', 'country'];
        try {
            const parser = new Parser({ fields });
            fs.writeFileSync(CSV_OUTPUT_FILE, parser.parse(results));
        } catch (err) {
            console.error('Error creating CSV:', err);
        }
    }
}

async function processCSV(filePath) {
    const uniqueAuthorIds = new Set();

    return new Promise((resolve, reject) => {
        console.log(`\n====================================================`);
        console.log(`  Scopus Author Processor (Resumable + Search API)`);
        console.log(`====================================================`);
        console.log(`Reading CSV: ${filePath}\n`);

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                const ids = row['Author(s) ID'] || '';
                if (ids) {
                    ids.split(';').forEach(id => {
                        const trimmed = id.trim();
                        if (trimmed) uniqueAuthorIds.add(trimmed);
                    });
                }
            })
            .on('end', async () => {
                const allIds = Array.from(uniqueAuthorIds);

                // Separate cached from pending
                const alreadyChecked = allIds.filter(id => cache[id] !== undefined);
                const pendingIds = allIds.filter(id => cache[id] === undefined);

                // Collect Sharda results from cache
                const results = [];
                alreadyChecked.forEach(id => {
                    if (cache[id] && cache[id].isSharda) results.push(cache[id]);
                });

                console.log(`📊 Status Report:`);
                console.log(`   Total unique Author IDs:  ${allIds.length}`);
                console.log(`   ✅ Already checked:        ${alreadyChecked.length}`);
                console.log(`   🟢 Sharda authors (cached): ${results.length}`);
                console.log(`   ⏳ Pending (to check):      ${pendingIds.length}`);
                console.log(``);

                if (pendingIds.length === 0) {
                    console.log(`🎉 All authors already processed!`);
                    saveResults(results);
                    return resolve(results);
                }

                // Process in batches of 25 (one API call per batch!)
                const BATCH_SIZE = 25;
                let processedCount = 0;
                let newShardaCount = 0;
                const totalBatches = Math.ceil(pendingIds.length / BATCH_SIZE);

                // Estimate API calls: ~1-2 per batch (pagination rarely needed)
                console.log(`📡 Estimated API calls: ~${totalBatches} (${BATCH_SIZE} authors per call)`);
                console.log(`   Remaining quota: check header after first call\n`);

                for (let i = 0; i < pendingIds.length; i += BATCH_SIZE) {
                    if (quotaExhausted) break;

                    const batch = pendingIds.slice(i, i + BATCH_SIZE);
                    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

                    try {
                        const shardaIds = await checkBatchSharda(batch);
                        processedCount += batch.length;

                        shardaIds.forEach(id => {
                            if (cache[id] && cache[id].isSharda) {
                                results.push(cache[id]);
                                newShardaCount++;
                            }
                        });

                        process.stdout.write(`\r  Batch ${batchNum}/${totalBatches} | Checked: ${alreadyChecked.length + processedCount}/${allIds.length} | Sharda: ${results.length} (+${newShardaCount} new)`);

                    } catch (err) {
                        if (err.message === 'QUOTA_EXHAUSTED') {
                            console.log(`\n\n💾 Saving progress...`);
                            quotaExhausted = true;
                        } else {
                            console.error(`\nBatch ${batchNum} error: ${err.message}`);
                        }
                    }

                    // Save progress every 10 batches
                    if (batchNum % 10 === 0 || quotaExhausted) {
                        saveCache();
                        saveFailed();
                        saveResults(results);
                    }

                    if (quotaExhausted) break;

                    // Small delay between batches
                    await sleep(500);
                }

                const remaining = pendingIds.length - processedCount;
                console.log(`\n\n====================================================`);
                console.log(`  Processing ${quotaExhausted ? 'PAUSED (quota hit)' : 'COMPLETE'}`);
                console.log(`====================================================`);
                console.log(`  Sharda authors found: ${results.length} (${newShardaCount} new this run)`);
                console.log(`  Authors checked:      ${alreadyChecked.length + processedCount}/${allIds.length}`);
                if (remaining > 0) {
                    console.log(`  Still pending:        ${remaining}`);
                    console.log(`\n  👉 Re-run the same command to continue!`);
                }
                console.log(`====================================================\n`);

                saveCache();
                saveFailed();
                saveResults(results);

                resolve(results);
            })
            .on('error', (err) => {
                console.error('CSV Parsing Error:', err);
                reject(err);
            });
    });
}

const csvFile = process.argv[2] || 'uploads/temp_test.csv';
processCSV(csvFile).then(() => {
    console.log('Done.');
    process.exit(0);
}).catch(err => {
    console.error('Fatal:', err.message);
    saveCache();
    saveFailed();
    process.exit(1);
});
