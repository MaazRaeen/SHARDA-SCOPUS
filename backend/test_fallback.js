const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const https = require('https');

const fetchDateFromCrossref = (doi) => {
    return new Promise((resolve) => {
        if (!doi) return resolve(null);
        const cleanDoi = String(doi).trim();
        const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;

        https.get(url, { headers: { 'User-Agent': 'ShardaResearchPortal/1.0 (mailto:research@sharda.ac.in)' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const message = json.message;
                    if (!message) return resolve(null);

                    // --- Helper: format [Y, M, D] array ---
                    const fmtParts = (parts) => {
                        if (!parts || parts.length === 0) return null;
                        const y = parts[0];
                        if (y <= 1900 || y >= 2100) return null;
                        let res = `${y}`;
                        if (parts.length > 1) {
                            res += `-${String(parts[1]).padStart(2, '0')}`;
                            if (parts.length > 2) {
                                res += `-${String(parts[2]).padStart(2, '0')}`;
                            }
                        }
                        return res;
                    };

                    if (Array.isArray(message.assertion)) {
                        const firstOnline = message.assertion.find(a => a.name === 'first_online');
                        if (firstOnline && firstOnline.value) {
                            const parsed = new Date(firstOnline.value);
                            if (!isNaN(parsed.getTime())) {
                                const y = parsed.getFullYear();
                                const m = parsed.getMonth() + 1;
                                const d = parsed.getDate();
                                return resolve({
                                    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                                });
                            }
                        }
                    }

                    const allCandidates = [
                        { src: 'published-online', parts: message['published-online']?.['date-parts']?.[0], priority: 1 },
                        { src: 'published-print', parts: message['published-print']?.['date-parts']?.[0], priority: 2 },
                        { src: 'issued', parts: message['issued']?.['date-parts']?.[0], priority: 3 },
                        { src: 'created', parts: message['created']?.['date-parts']?.[0], priority: 4 },
                        { src: 'deposited', parts: message['deposited']?.['date-parts']?.[0], priority: 5 },
                    ].filter(c => c.parts && c.parts.length > 0);

                    if (allCandidates.length > 0) {
                        let officialYear = 9999;
                        for (const c of allCandidates) {
                            if ((c.src === 'issued' || c.src === 'published-print' || c.src === 'published-online') && c.parts[0] < officialYear) {
                                officialYear = c.parts[0];
                            }
                        }

                        const validCandidates = allCandidates.filter(c => {
                            if (c.src === 'created' || c.src === 'deposited') {
                                if (officialYear !== 9999 && c.parts[0] > officialYear + 1) return false;
                            }
                            return true;
                        });

                        validCandidates.sort((a, b) => {
                            if (a.parts.length !== b.parts.length) {
                                return b.parts.length - a.parts.length;
                            }
                            return a.priority - b.priority;
                        });

                        if (validCandidates.length > 0) {
                            const bestParts = validCandidates[0].parts;
                            const bestDate = fmtParts(bestParts);
                            if (bestDate) {
                                return resolve({ date: bestDate });
                            }
                        }
                    }
                    resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => {
            resolve(null);
        });
    });
};

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        // Find papers that fell back to their year (e.g. publicationDate is a full year date like 2025-01-01)
        // Wait, the DB stores them as Dates. We can just use MongoDB's `$expr` to find where month and day are 1 and year matches `year`.
        // Or simpler, just find 5 papers with an explicit DOI where `publicationDate` exists.

        const fallbackPapers = await ShardaAuthor.find({
            doi: { $exists: true, $ne: "" },
            year: { $exists: true }
        }).limit(200).lean();

        let foundFallbacks = [];
        for (const p of fallbackPapers) {
            if (p.publicationDate) {
                const dateObj = new Date(p.publicationDate);
                // If it's a fallback date, it's typically YYYY-01-01T00:00:00
                if (dateObj.getMonth() === 0 && dateObj.getDate() === 1 && dateObj.getFullYear() === p.year) {
                    foundFallbacks.push(p);
                }
            }
            if (foundFallbacks.length >= 5) break;
        }

        console.log(`Found ${foundFallbacks.length} fallback DOIs.`);
        for (const p of foundFallbacks) {
            console.log(`\nTesting Fallback DOI: ${p.doi} (Year: ${p.year})`);
            const crossrefRes = await fetchDateFromCrossref(p.doi);
            console.log(`  -> Crossref standalone fetch returned: ${crossrefRes ? crossrefRes.date : 'NULL'}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
run();
