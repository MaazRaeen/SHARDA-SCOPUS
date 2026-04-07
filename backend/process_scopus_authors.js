const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const path = require('path');
const { Parser } = require('json2csv');
const pLimit = require('p-limit');
require('dotenv').config();

const limit = pLimit(1); // Single concurrency to avoid burst rate limits

const API_KEY = process.env.SCOPUS_API_KEY;
const SHARDA_AFID = '60108680';
const CACHE_FILE = 'scopus_cache.json';
const FAILED_FILE = 'scopus_failed.json'; // Track permanently failed IDs
const OUTPUT_FILE = 'sharda_authors_output.json';
const CSV_OUTPUT_FILE = 'sharda_authors_output.csv';

// ---- Load Cache (successful fetches) ----
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
}

// ---- Load Failed IDs (non-quota failures like 404, bad data) ----
let failedIds = {};
if (fs.existsSync(FAILED_FILE)) {
    failedIds = JSON.parse(fs.readFileSync(FAILED_FILE, 'utf-8'));
}

// ---- Global flag for quota exhaustion ----
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

async function fetchWithRetry(url, headers, retries = 5, delay = 2000) {
    try {
        const response = await axios.get(url, { headers, timeout: 30000 });
        return response.data;
    } catch (err) {
        const status = err.response?.status;
        if (status === 429) {
            const h = err.response.headers;
            const remaining = h["x-ratelimit-remaining"];
            const reset = h["x-ratelimit-reset"];
            const retryAfter = h["retry-after"];
            
            console.log(`\n[429] Quota Remaining: ${remaining} | Reset epoch: ${reset}`);
            
            // Check if quota is fully exhausted:
            // Either remaining === 0 OR headers are missing entirely (Elsevier blocks hard)
            const isExhausted = (remaining !== undefined && parseInt(remaining) === 0) || 
                                (remaining === undefined && reset === undefined);
            
            if (isExhausted) {
                let waitHours = 'unknown';
                let resetTimeStr = 'unknown';
                
                if (reset) {
                    const resetTime = parseInt(reset);
                    const now = Math.floor(Date.now() / 1000);
                    const waitSeconds = resetTime > now ? resetTime - now : 0;
                    waitHours = (waitSeconds / 3600).toFixed(1);
                    resetTimeStr = new Date(resetTime * 1000).toLocaleString();
                }
                
                console.log(`\n╔══════════════════════════════════════════════════════╗`);
                console.log(`║  API QUOTA EXHAUSTED — Saving progress & exiting     ║`);
                console.log(`║  Quota resets in: ~${waitHours} hours                       ║`);
                console.log(`║  Reset time: ${resetTimeStr}                          ║`);
                console.log(`║                                                      ║`);
                console.log(`║  👉 Just re-run the same command to resume!          ║`);
                console.log(`╚══════════════════════════════════════════════════════╝\n`);
                
                quotaExhausted = true;
                throw new Error("QUOTA_EXHAUSTED");
            }

            // Not fully exhausted, just a burst limit — retry with backoff
            if (retries > 0) {
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay;
                console.log(`[429] Burst rate limit. Retrying in ${waitTime}ms... (${retries} left)`);
                await sleep(waitTime);
                return fetchWithRetry(url, headers, retries - 1, delay * 2);
            }
        }
        
        if (status === 401) {
            console.error(`\n[401] Unauthorized. Check your API key.`);
            throw new Error('Unauthorized');
        }

        if (retries > 0 && (!status || status >= 500)) {
            console.log(`\n[${status || 'Error'}] Retrying ${url} in ${delay}ms...`);
            await sleep(delay);
            return fetchWithRetry(url, headers, retries - 1, delay * 2);
        }

        console.error(`\nFailed: ${url} | Status: ${status || err.message}`);
        return null;
    }
}

async function getAuthorDetails(authorId) {
    // Skip if already cached
    if (cache[authorId]) return cache[authorId];
    
    // Skip if previously failed with a permanent error (not quota)
    if (failedIds[authorId]) return null;

    const url = `https://api.elsevier.com/content/author/author_id/${authorId}?view=ENHANCED`;
    const headers = {
        'X-ELS-APIKey': API_KEY,
        'Accept': 'application/json'
    };

    try {
        await sleep(1000); // 1 second stagger between requests to stay well under burst limits
        const response = await fetchWithRetry(url, headers);
        if (!response) {
            // Mark as failed so we don't retry it next run (non-quota failure)
            failedIds[authorId] = { reason: 'no_response', time: new Date().toISOString() };
            return null;
        }

        const entry = response['author-retrieval-response']?.[0];
        if (!entry) {
            failedIds[authorId] = { reason: 'no_entry', time: new Date().toISOString() };
            return null;
        }

        const profile = entry['author-profile'];
        const nameObj = profile['preferred-name'];
        const givenName = nameObj['given-name'] || '';
        const surname = nameObj['surname'] || '';
        const fullName = `${givenName} ${surname}`.trim();

        const currentAffRaw = entry['author-profile']?.['affiliation-current']?.['affiliation'];
        const affiliations = Array.isArray(currentAffRaw) ? currentAffRaw : (currentAffRaw ? [currentAffRaw] : []);
        
        let university = '';
        let city = '';
        let country = '';
        let afid = '';
        let department = '';
        let isSharda = false;

        for (const aff of affiliations) {
            const ipDoc = aff['ip-doc'] || aff;
            const currentAfid = aff['@id'] || ipDoc['@id'] || '';
            
            const parentName = ipDoc['parent-preferred-name']?.['$'];
            const prefName = ipDoc['preferred-name']?.['$'];
            const dispName = ipDoc['afdispname'] || ipDoc['name'] || ipDoc['affilname'] || '';
            const address = ipDoc['address'] || {};
            
            const univCandidate = parentName || dispName || '';
            const deptCandidate = prefName || '';
            const isShardaCandidate = currentAfid === SHARDA_AFID || univCandidate.toLowerCase().includes('sharda');

            if (isShardaCandidate || !university) {
                afid = currentAfid;
                university = univCandidate;
                department = deptCandidate;
                city = address['city'] || ipDoc['city'] || '';
                country = address['country'] || ipDoc['country'] || '';
                isSharda = isShardaCandidate;
            }
            
            if (isSharda) break;
        }

        if (university.includes(',') && !department) {
            const parts = university.split(',');
            department = parts[0].trim();
            university = parts[1].trim();
        }

        const authorData = {
            authorId,
            fullName,
            university,
            department,
            city,
            country,
            afid,
            isSharda
        };

        // If affiliated with Sharda but no department, try Affiliation API
        if (authorData.isSharda && !authorData.department && afid) {
            try {
                const affUrl = `https://api.elsevier.com/content/affiliation/affiliation_id/${afid}`;
                const affResponse = await fetchWithRetry(affUrl, headers);
                const affProf = affResponse?.['affiliation-retrieval-response'];
                if (affProf && affProf['institution-profile']) {
                    const detailedName = affProf['affiliation-name'] || '';
                    if (detailedName.toLowerCase().includes('department')) {
                        authorData.department = detailedName;
                    }
                }
            } catch (e) {
                if (e.message === 'QUOTA_EXHAUSTED') throw e; // Bubble up
                console.log(`Could not fetch extra affiliation details for ${afid}`);
            }
        }

        cache[authorId] = authorData;
        // Don't save cache on every single fetch — we'll save per batch
        return authorData;
    } catch (error) {
        if (error.message === 'QUOTA_EXHAUSTED') throw error; // Bubble up!
        console.error(`Failed to fetch author ${authorId}: ${error.message}`);
        failedIds[authorId] = { reason: error.message, time: new Date().toISOString() };
        return null;
    }
}

function saveResults(results) {
    // Save JSON
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    
    // Save CSV
    if (results.length > 0) {
        const fields = ['fullName', 'authorId', 'university', 'department', 'city', 'country'];
        try {
            const parser = new Parser({ fields });
            const csvOutput = parser.parse(results);
            fs.writeFileSync(CSV_OUTPUT_FILE, csvOutput);
        } catch (err) {
            console.error('Error creating CSV:', err);
        }
    }
}

async function processCSV(filePath) {
    const uniqueAuthorIds = new Set();
    const results = [];

    return new Promise((resolve, reject) => {
        console.log(`\n====================================`);
        console.log(`  Scopus Author Processor (Resumable)`);
        console.log(`====================================`);
        console.log(`Reading CSV: ${filePath}`);
        
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
                const allAuthorIds = Array.from(uniqueAuthorIds);
                
                // Separate already-cached from pending
                const cachedIds = allAuthorIds.filter(id => cache[id]);
                const failedPermanent = allAuthorIds.filter(id => !cache[id] && failedIds[id]);
                const pendingIds = allAuthorIds.filter(id => !cache[id] && !failedIds[id]);
                
                console.log(`\n📊 Status Report:`);
                console.log(`   Total unique Author IDs: ${allAuthorIds.length}`);
                console.log(`   ✅ Already cached:       ${cachedIds.length}`);
                console.log(`   ❌ Previously failed:     ${failedPermanent.length}`);
                console.log(`   ⏳ Pending (to fetch):    ${pendingIds.length}`);
                console.log(``);

                // First, collect results from cache
                cachedIds.forEach(id => {
                    if (cache[id] && cache[id].isSharda) {
                        results.push(cache[id]);
                    }
                });
                console.log(`Loaded ${results.length} Sharda authors from cache.\n`);

                if (pendingIds.length === 0) {
                    console.log(`🎉 All authors already processed! Nothing to fetch.`);
                    saveResults(results);
                    return resolve(results);
                }

                // Process pending in batches
                const batchSize = 20; // Smaller batches for safer rate limiting
                let processedCount = 0;
                let newShardaCount = 0;

                for (let i = 0; i < pendingIds.length; i += batchSize) {
                    if (quotaExhausted) break;

                    const batch = pendingIds.slice(i, i + batchSize);
                    const batchNum = Math.floor(i / batchSize) + 1;
                    const totalBatches = Math.ceil(pendingIds.length / batchSize);
                    console.log(`\n--- Batch ${batchNum}/${totalBatches} (${batch.length} authors) ---`);

                    try {
                        const batchPromises = batch.map(id =>
                            limit(async () => {
                                if (quotaExhausted) return null;
                                const details = await getAuthorDetails(id);
                                processedCount++;
                                process.stdout.write(`\rProgress: ${cachedIds.length + processedCount}/${allAuthorIds.length} total | ${processedCount}/${pendingIds.length} new`);
                                return details;
                            })
                        );

                        const batchResults = await Promise.all(batchPromises);
                        
                        batchResults.forEach(details => {
                            if (details && details.isSharda) {
                                results.push(details);
                                newShardaCount++;
                            }
                        });
                    } catch (err) {
                        if (err.message === 'QUOTA_EXHAUSTED') {
                            console.log(`\n\n💾 Saving all progress before exit...`);
                            quotaExhausted = true;
                            // Don't break — fall through to save
                        } else {
                            console.error(`\nBatch error: ${err.message}`);
                        }
                    }

                    // Save progress after every batch
                    saveCache();
                    saveFailed();
                    saveResults(results);

                    if (quotaExhausted) break;

                    // Cool down between batches
                    if (i + batchSize < pendingIds.length) {
                        console.log(`\nBatch done. Cooling down 5s...`);
                        await sleep(5000);
                    }
                }

                // Final summary
                const remaining = pendingIds.length - processedCount;
                console.log(`\n\n====================================`);
                console.log(`  Processing ${quotaExhausted ? 'PAUSED (quota hit)' : 'COMPLETE'}`);
                console.log(`====================================`);
                console.log(`  Sharda authors found: ${results.length} (${newShardaCount} new this run)`);
                console.log(`  Authors processed:    ${cachedIds.length + processedCount}/${allAuthorIds.length}`);
                if (remaining > 0) {
                    console.log(`  Still pending:        ${remaining}`);
                    console.log(`\n  👉 Re-run the same command to continue!`);
                }
                console.log(`====================================\n`);
                
                // Final save
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
console.log(`Starting process for file: ${csvFile}`);
processCSV(csvFile).then(() => {
    console.log('Finished processing.');
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err.message);
    // Still save on fatal
    saveCache();
    saveFailed();
    process.exit(1);
});
