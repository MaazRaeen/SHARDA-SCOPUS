require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const ShardaAuthor = require('./models/ShardaAuthor');

// Crossref Fetch Logic
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
                        const m = parts[1] || 1;
                        const d = parts[2] || 1;
                        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    };

                    if (Array.isArray(message.assertion)) {
                        const firstOnline = message.assertion.find(a => a.name === 'first_online');
                        if (firstOnline && firstOnline.value) {
                            const parsed = new Date(firstOnline.value);
                            if (!isNaN(parsed.getTime())) {
                                const y = parsed.getFullYear();
                                const m = parsed.getMonth() + 1;
                                const d = parsed.getDate();
                                return resolve(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                            }
                        }
                    }

                    const candidates = [
                        { src: 'published-print', parts: message['published-print']?.['date-parts']?.[0] },
                        { src: 'published-online', parts: message['published-online']?.['date-parts']?.[0] },
                        { src: 'deposited', parts: message['deposited']?.['date-parts']?.[0] },
                        { src: 'issued', parts: message['issued']?.['date-parts']?.[0] },
                        { src: 'created', parts: message['created']?.['date-parts']?.[0] },
                    ].filter(c => c.parts && c.parts.length > 0);

                    if (candidates.length > 0) {
                        candidates.sort((a, b) => b.parts.length - a.parts.length);
                        const best = fmtParts(candidates[0].parts);
                        if (best) return resolve(best);
                    }
                    resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
};

// Scopus Fetch Logic
const fetchDoiFromScopus = (title, apiKey) => {
    return new Promise((resolve) => {
        if (!title || !apiKey) return resolve(null);

        // Exact title search in Scopus
        const query = `TITLE("${title}")`;
        const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(query)}&count=1&apiKey=${apiKey}`;

        https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const results = json['search-results']?.entry;
                    if (results && results.length > 0) {
                        const firstResult = results[0];
                        const doi = firstResult['prism:doi'];
                        if (doi) return resolve(doi);
                    }
                    resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            console.error(`Error searching Scopus for ${title}:`, e.message);
            resolve(null);
        });
    });
};

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const apiKey = process.env.SCOPUS_API_KEY;

        if (!apiKey) {
            console.log("SCOPUS_API_KEY is not defined in .env. Exiting.");
            process.exit(1);
        }

        // Find papers without DOI
        // Since titles are duplicated per author, let's get unique titles missing DOIs
        const papersWithoutDoi = await ShardaAuthor.find({
            $or: [
                { doi: { $exists: false } },
                { doi: null },
                { doi: "" }
            ]
        }).select('paperTitle').lean();

        const uniqueTitles = [...new Set(papersWithoutDoi.map(p => p.paperTitle).filter(t => t))];
        console.log(`Found ${papersWithoutDoi.length} records missing a DOI.`);
        console.log(`This corresponds to ${uniqueTitles.length} unique paper titles.`);

        let successCount = 0;
        let delayMs = 250; // Delay to prevent Scopus API rate limits

        for (let i = 0; i < uniqueTitles.length; i++) {
            const title = uniqueTitles[i];
            console.log(`[${i + 1}/${uniqueTitles.length}] Searching Scopus for: "${title.substring(0, 50)}..."`);

            const doi = await fetchDoiFromScopus(title, apiKey);

            if (doi) {
                console.log(`  -> Found DOI: ${doi}`);

                // Now fetch date from Crossref
                const pubDate = await fetchDateFromCrossref(doi);
                if (pubDate) {
                    console.log(`  -> Fetched Date: ${pubDate}`);
                } else {
                    console.log(`  -> No date found on Crossref`);
                }

                // Update all records with this title
                const updateQuery = { paperTitle: title };
                const updateData = { $set: { doi: doi } };
                if (pubDate) {
                    updateData.$set.publicationDate = pubDate;
                }

                await ShardaAuthor.updateMany(updateQuery, updateData);
                successCount++;
            } else {
                console.log(`  -> No DOI found.`);
            }

            // Respect rate limits 
            await new Promise(r => setTimeout(r, delayMs));
        }

        console.log(`\nDONE! Successfully found and updated DOIs for ${successCount} titles.`);

    } catch (e) {
        console.error('Fatal Error:', e);
    } finally {
        mongoose.disconnect();
    }
})();
