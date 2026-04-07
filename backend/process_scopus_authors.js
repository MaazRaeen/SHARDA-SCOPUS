const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const path = require('path');
const { Parser } = require('json2csv');
const pLimit = require('p-limit');
require('dotenv').config();

const limit = pLimit(2); // control concurrency - lowered back for safety

const API_KEY = process.env.SCOPUS_API_KEY;
const SHARDA_AFID = '60108680';
const CACHE_FILE = 'scopus_cache.json';
const OUTPUT_FILE = 'sharda_authors_output.json';
const CSV_OUTPUT_FILE = 'sharda_authors_output.csv';

let cache = {};
if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
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
        if (status === 429 && retries > 0) {
            const retryAfter = err.response.headers["retry-after"];
            const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay;

            console.log(`\n[429] Rate limited on ${url}. Retrying in ${waitTime}ms... (${retries} left)`);
            await sleep(waitTime);
            return fetchWithRetry(url, headers, retries - 1, delay * 2);
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

async function getAuthorDetails(authorId, isPriority = false) {
    if (cache[authorId]) return cache[authorId];

    const url = `https://api.elsevier.com/content/author/author_id/${authorId}?view=ENHANCED`;
    const headers = {
        'X-ELS-APIKey': API_KEY,
        'Accept': 'application/json'
    };

    try {
        if (!isPriority) await sleep(500); // slight stagger for non-priority - increased for safety
        const response = await fetchWithRetry(url, headers);
        if (!response) return null;

        const entry = response['author-retrieval-response']?.[0];
        if (!entry) return null;

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

            // If we found Sharda, or if we don't have any university yet, pick this one
            if (isShardaCandidate || !university) {
                afid = currentAfid;
                university = univCandidate;
                department = deptCandidate;
                city = address['city'] || ipDoc['city'] || '';
                country = address['country'] || ipDoc['country'] || '';
                isSharda = isShardaCandidate;
            }
            
            if (isSharda) break; // Priority to Sharda if multiple affiliations
        }

        // Cleanup: univ might still have trailing commas if extracted from dispName
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
                const affProf = affResponse['affiliation-retrieval-response'];
                if (affProf && affProf['institution-profile']) {
                    // Sometimes department is in preferred-name or child affiliations
                    // But for simplicity, we'll check if there's a more detailed name
                    const detailedName = affProf['affiliation-name'] || '';
                    if (detailedName.toLowerCase().includes('department')) {
                        authorData.department = detailedName;
                    }
                }
            } catch (e) {
                console.log(`Could not fetch extra affiliation details for ${afid}`);
            }
        }

        cache[authorId] = authorData;
        saveCache();
        return authorData;
    } catch (error) {
        console.error(`Failed to fetch author ${authorId}: ${error.message}`);
        return null;
    }
}

async function processCSV(filePath) {
    const uniqueAuthorIds = new Set();
    const results = [];

    return new Promise((resolve, reject) => {
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
                const authorIds = Array.from(uniqueAuthorIds);
                console.log(`Found ${authorIds.length} unique Author IDs.`);
                
                const batchSize = 50;
                let processedCount = 0;

                for (let i = 0; i < authorIds.length; i += batchSize) {
                    const batch = authorIds.slice(i, i + batchSize);
                    console.log(`\n--- Starting Batch ${Math.floor(i / batchSize) + 1} (${batch.length} authors) ---`);

                    const batchPromises = batch.map(id =>
                        limit(async () => {
                            const details = await getAuthorDetails(id);
                            processedCount++;
                            if (processedCount % 10 === 0 || processedCount === authorIds.length) {
                                process.stdout.write(`\rProgress: ${processedCount}/${authorIds.length} authors processed...`);
                            }
                            return details;
                        })
                    );

                    const batchResults = await Promise.all(batchPromises);
                    
                    // Filter and add to final results
                    batchResults.forEach(details => {
                        if (details && details.isSharda) {
                            results.push(details);
                        }
                    });

                    // Periodic save
                    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
                    saveCache();

                    if (i + batchSize < authorIds.length) {
                        console.log(`\nBatch complete. Cooling down for 8 seconds...`);
                        await sleep(8000);
                    }
                }

                console.log(`\n\nFinished. Found ${results.length} Sharda University authors.`);
                
                // Final Save JSON
                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
                
                // Save CSV
                if (results.length > 0) {
                    const fields = ['fullName', 'authorId', 'university', 'department', 'city', 'country'];
                    const opts = { fields };
                    try {
                        const parser = new Parser(opts);
                        const csvOutput = parser.parse(results);
                        fs.writeFileSync(CSV_OUTPUT_FILE, csvOutput);
                    } catch (err) {
                        console.error('Error creating CSV:', err);
                    }
                }
                
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
}).catch(err => {
    console.error('Fatal error:', err);
});
