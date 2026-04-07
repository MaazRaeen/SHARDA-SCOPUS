const fs = require('fs');
const csv = require('csv-parser');
const https = require('https');
const path = require('path');
const { Parser } = require('json2csv');
require('dotenv').config();

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

function fetchWithRetry(url, headers, retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            https.get(url, { headers }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error(`JSON Parse Error: ${e.message}`));
                        }
                    } else if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                        console.log(`Redirecting to ${res.headers.location}...`);
                        fetchWithRetry(res.headers.location, headers, n).then(resolve).catch(reject);
                    } else if (res.statusCode === 429 && n > 0) {
                        console.log(`Rate limited, retrying in 5s... (${n} retries left)`);
                        setTimeout(() => attempt(n - 1), 5000);
                    } else {
                        reject(new Error(`API Error: ${res.statusCode} for ${url}`));
                    }
                });
            }).on('error', (err) => {
                if (n > 0) {
                    console.log(`Error: ${err.message}, retrying...`);
                    setTimeout(() => attempt(n - 1), 2000);
                } else {
                    reject(err);
                }
            });
        };
        attempt(retries);
    });
}

async function getAuthorDetails(authorId) {
    if (cache[authorId]) return cache[authorId];

    const url = `https://api.elsevier.com/content/author/author_id/${authorId}?view=ENHANCED`;
    const headers = {
        'X-ELS-APIKey': API_KEY,
        'Accept': 'application/json'
    };

    try {
        const response = await fetchWithRetry(url, headers);
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
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                // Scopus CSV headers often have "Author(s) ID"
                const ids = row['Author(s) ID'] || '';
                if (ids) {
                    ids.split(';').forEach(id => {
                        const trimmed = id.trim();
                        if (trimmed) uniqueAuthorIds.add(trimmed);
                    });
                }
            })
            .on('end', async () => {
                console.log(`Found ${uniqueAuthorIds.size} unique Author IDs.`);
                let count = 0;
                for (const authorId of uniqueAuthorIds) {
                    count++;
                    process.stdout.write(`\rProcessing ${count}/${uniqueAuthorIds.size}...`);
                    const details = await getAuthorDetails(authorId);
                    if (details && details.isSharda) {
                        results.push(details);
                        // Save JSON periodically
                        if (results.length % 5 === 0) {
                            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
                        }
                    }
                    // Avoid hitting rate limits too hard if many new IDs
                    if (!cache[authorId]) {
                        await new Promise(r => setTimeout(r, 2000)); // 2000ms delay for new items
                    }
                }
                console.log(`\nFound ${results.length} Sharda University authors.`);
                
                // Save JSON
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
            .on('error', reject);
    });
}

const csvFile = process.argv[2] || 'uploads/temp_test.csv';
console.log(`Starting process for file: ${csvFile}`);
processCSV(csvFile).then(() => {
    console.log('Finished processing.');
}).catch(err => {
    console.error('Fatal error:', err);
});
