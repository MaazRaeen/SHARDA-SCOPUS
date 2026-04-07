require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const ShardaAuthor = require('./models/ShardaAuthor');

// Crossref Fetch Logic (matches paperController.js exactly)
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

                    // 1. Check assertions for "first_online"
                    if (Array.isArray(message.assertion)) {
                        const firstOnline = message.assertion.find(a => a.name === 'first_online');
                        if (firstOnline && firstOnline.value) {
                            const parsed = new Date(firstOnline.value);
                            if (!isNaN(parsed.getTime())) {
                                const y = parsed.getFullYear();
                                const m = parsed.getMonth() + 1;
                                const d = parsed.getDate();
                                return resolve({
                                    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                                    title: message.title ? message.title[0] : null,
                                    year: y
                                });
                            }
                        }
                    }

                    // 2. Collect candidates
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
                                return resolve({
                                    date: bestDate,
                                    title: message.title ? message.title[0] : null,
                                    year: bestParts[0]
                                });
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

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB");

        // We fetch ALL papers. We can update unique DOIs first, then update papers without DOIs
        // Wait, ShardaAuthor has many duplicate DOIs because a paper can have multiple Sharda authors.
        // It's faster to find all unique DOIs, fetch their dates, and update all matching papers at once.
        const papersWithDoi = await ShardaAuthor.find({
            doi: { $exists: true, $ne: null, $ne: "" }
        }).select('doi year').lean();

        // Get unique DOIs and their associated year if they have one
        const doiMap = new Map();
        papersWithDoi.forEach(p => {
            const cleanDoi = p.doi.trim().toLowerCase();
            if (!doiMap.has(cleanDoi)) {
                doiMap.set(cleanDoi, { originalDoi: p.doi, fallbackYear: p.year });
            }
        });

        console.log(`Found ${papersWithDoi.length} total paper records with DOIs.`);
        console.log(`Found ${doiMap.size} unique DOIs.`);

        const uniqueDois = Array.from(doiMap.keys());

        // Settings for concurrent fetching
        const CROSSREF_CONCURRENCY = 20;
        let successDateCount = 0;
        let fallbackYearCount = 0;

        for (let i = 0; i < uniqueDois.length; i += CROSSREF_CONCURRENCY) {
            const batch = uniqueDois.slice(i, i + CROSSREF_CONCURRENCY);
            console.log(`Processing batch ${i + 1} to ${i + batch.length} of ${uniqueDois.length}...`);

            const promises = batch.map(async (lowerDoi) => {
                const info = doiMap.get(lowerDoi);
                const crossrefData = await fetchDateFromCrossref(info.originalDoi);

                let updateData = {};
                let displayDate = "";

                if (crossrefData && crossrefData.date) {
                    updateData.publicationDate = crossrefData.date;
                    if (crossrefData.year) updateData.year = crossrefData.year;
                    successDateCount++;
                    displayDate = crossrefData.date;
                } else {
                    // Fallback to year if DOI exists but no exact date found
                    if (info.fallbackYear) {
                        updateData.publicationDate = String(info.fallbackYear);
                        fallbackYearCount++;
                        displayDate = `Fallback: ${info.fallbackYear}`;
                    } else {
                        // Skip if we don't even have a year
                        return;
                    }
                }

                if (Object.keys(updateData).length > 0) {
                    await ShardaAuthor.updateMany(
                        { doi: { $regex: new RegExp(`^${info.originalDoi.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                        { $set: updateData }
                    );
                    // console.log(`  -> ${info.originalDoi}: set publicationDate to ${displayDate}`);
                }
            });

            await Promise.all(promises);

            // Small delay to respect rate limits
            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`\nFinished processing papers WITH DOIs.`);
        console.log(`  -> Valid precise dates retrieved: ${successDateCount}`);
        console.log(`  -> Fallback year used for missing precise dates: ${fallbackYearCount}`);

        // Now update papers WITHOUT DOIs (fallback to year)
        console.log(`\nProcessing papers WITHOUT DOIs...`);
        const papersWithoutDoiMap = await ShardaAuthor.find({
            $or: [
                { doi: { $exists: false } },
                { doi: null },
                { doi: "" }
            ],
            year: { $exists: true, $ne: null }
        }).lean();

        let noDoiUpdateCount = 0;
        // Group by title to optimize
        for (const p of papersWithoutDoiMap) {
            // Only update if publicationDate isn't already set to the year (to save DB calls)
            // But just to ensure consistency, we'll run updateMany based on title to catch duplicates of this paper quickly
            if (p.year && p.publicationDate !== String(p.year)) {
                await ShardaAuthor.updateMany(
                    { paperTitle: p.paperTitle },
                    { $set: { publicationDate: String(p.year) } }
                );
                noDoiUpdateCount++;
            }
        }

        console.log(`  -> Updated ${noDoiUpdateCount} paper sets without DOIs to use their Year as publicationDate.`);
        console.log(`\nDONE!`);

    } catch (e) {
        console.error('Fatal Error:', e);
    } finally {
        mongoose.disconnect();
    }
})();
