require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const ShardaAuthor = require('./models/ShardaAuthor');

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
                            if (a.parts.length !== b.parts.length) return b.parts.length - a.parts.length;
                            return a.priority - b.priority;
                        });

                        if (validCandidates.length > 0) {
                            const bestParts = validCandidates[0].parts;
                            const bestDate = fmtParts(bestParts);
                            if (bestDate) return resolve({ date: bestDate });
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

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB");

        // Find papers that likely fell back to Jan 1st of their year
        const papers = await ShardaAuthor.find({
            doi: { $exists: true, $ne: "" },
            year: { $exists: true, $ne: null },
            publicationDate: { $exists: true, $ne: null }
        }).select('doi year publicationDate').lean();

        // Filter DOIs where publication date is exactly Jan 1 of their Year
        const fallbackDois = new Map();
        for (const p of papers) {
            const dateObj = new Date(p.publicationDate);
            if (dateObj.getMonth() === 0 && dateObj.getDate() === 1 && dateObj.getFullYear() === p.year) {
                const lowerDoi = p.doi.trim().toLowerCase();
                if (!fallbackDois.has(lowerDoi)) {
                    fallbackDois.set(lowerDoi, p.doi);
                }
            }
        }

        const uniqueDoisToRetry = Array.from(fallbackDois.values());
        console.log(`Found ${uniqueDoisToRetry.length} DOIs that fell back to Jan 1st (API rate limited). Retrying them...`);

        // Slower concurrency to guarantee success without rate limits
        const CROSSREF_CONCURRENCY = 5;
        let successDateCount = 0;

        for (let i = 0; i < uniqueDoisToRetry.length; i += CROSSREF_CONCURRENCY) {
            const batch = uniqueDoisToRetry.slice(i, i + CROSSREF_CONCURRENCY);
            console.log(`Retrying batch ${i + 1} to ${i + batch.length} of ${uniqueDoisToRetry.length}...`);

            const promises = batch.map(async (originalDoi) => {
                const crossrefData = await fetchDateFromCrossref(originalDoi);

                if (crossrefData && crossrefData.date) {
                    // Make sure it didn't just return Jan 1 again
                    if (!crossrefData.date.endsWith('-01-01')) {
                        await ShardaAuthor.updateMany(
                            { doi: { $regex: new RegExp(`^${originalDoi.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                            { $set: { publicationDate: crossrefData.date } }
                        );
                        successDateCount++;
                    }
                }
            });

            await Promise.all(promises);
            await new Promise(r => setTimeout(r, 1000)); // 1 second delay
        }

        console.log(`\nSuccessfully recovered exact dates for ${successDateCount} papers!`);
    } catch (e) {
        console.error(e);
    } finally {
        mongoose.disconnect();
    }
})();
