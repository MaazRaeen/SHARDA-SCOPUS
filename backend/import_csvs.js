require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const csv = require('csv-parser');
const https = require('https');

/**
 * Fetch exact publication date for a DOI using the improved Crossref logic.
 */
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
                    // 1. assertion first_online
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
                    // 2. date-parts candidates
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

/**
 * Fetch DOI from Scopus API using paper title
 */
const fetchDoiFromScopus = (title, apiKey) => {
    return new Promise((resolve) => {
        if (!title || !apiKey) return resolve(null);

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
async function importCsvs() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');

    const files = fs.readdirSync('uploads').filter(f => f.endsWith('.csv')).map(f => `uploads/${f}`);

    for (const file of files) {
        console.log(`Processing file: ${file}`);
        const rows = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(file)
                .pipe(csv())
                .on('data', (data) => rows.push(data))
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`Found ${rows.length} rows in ${file}`);

        let newRecords = 0;
        let updatedRecords = 0;

        for (const row of rows) {
            const keys = Object.keys(row);
            const titleCol = keys.find(k => k.toLowerCase().includes('title') && !k.toLowerCase().includes('source'));
            if (!titleCol) continue;

            const title = row[titleCol]?.trim();
            if (!title) continue;

            const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');

            const doiCol = keys.find(k => k.toLowerCase() === 'doi');
            const linkCol = keys.find(k => k.toLowerCase().includes('link'));
            const yearCol = keys.find(k => k.toLowerCase() === 'year');
            const sourceCol = keys.find(k => k.toLowerCase().includes('source') || k.toLowerCase().includes('journal'));
            const typeCol = keys.find(k => k.toLowerCase().includes('type'));
            const publisherCol = keys.find(k => k.toLowerCase().includes('publisher'));
            const citationsCol = keys.find(k => k.toLowerCase().includes('cited'));

            let doi = row[doiCol]?.trim() || '';

            // If DOI is missing from CSV, try to fetch it from Scopus using the title
            if (!doi) {
                console.log(`DOI missing in CSV for "${title.substring(0, 30)}...". Fetching from Scopus...`);
                doi = await fetchDoiFromScopus(title, process.env.SCOPUS_API_KEY) || '';
                if (doi) {
                    console.log(`  -> Found DOI from Scopus: ${doi}`);
                } else {
                    console.log(`  -> No DOI found on Scopus.`);
                }
            } else {
                console.log(`Processing DOI: ${doi}`);
            }

            const link = row[linkCol]?.trim() || '';
            let year = parseInt(row[yearCol]);
            year = isNaN(year) ? null : year;
            const source = row[sourceCol]?.trim() || '';
            const type = row[typeCol]?.trim() || '';
            const publisher = row[publisherCol]?.trim() || '';
            let citations = parseInt(row[citationsCol]);
            citations = isNaN(citations) ? 0 : citations;


            const existing = await ShardaAuthor.findOne({ paperTitle: title });

            if (!existing) {
                // If the paper doesn't exist at all, we could add it, but ShardaAuthor requires an `authorName`.
                // For this script, we'll only update existing papers with new DOI/Link/Citations or look for a Sharda author.
                // To keep it simple and accurate, we will try to find *any* author from Sharda in the affiliation string.

                const affiliationCol = keys.find(k => k.toLowerCase().includes('affiliation'));
                const affiliations = row[affiliationCol]?.toLowerCase() || '';

                if (affiliations.includes('sharda university')) {
                    // Get all authors from the authors column
                    const authorsCol = keys.find(k => k.toLowerCase() === 'authors');
                    if (authorsCol && row[authorsCol]) {
                        const authors = row[authorsCol].split(',').map(a => a.trim());

                        // In a real scenario, we'd need to match authors to their specific affiliations.
                        // But for now, if the paper has Sharda University in affiliations, we'll add a record 
                        // for the first author (or a placeholder) just to get the paper and its citations in the DB.
                        // It's better to use the main ingestion logic for full parsing, but this gets the paper in.

                        const newAuthor = new ShardaAuthor({
                            authorName: authors[0] || 'Unknown Author',
                            department: 'NA', // We don't have department info here easily
                            paperTitle: title,
                            year: year,
                            sourcePaper: source,
                            publisher: publisher,
                            paperType: type,
                            doi: doi,
                            link: link,
                            citedBy: citations,
                            countries: [] // Not parsing countries here for simplicity
                            , publicationDate: null // will be set below if DOI is present
                        });
                        // Attempt to fetch publication date via Crossref if DOI exists
                        if (doi) {
                            console.log(`Fetching publication date for DOI: ${doi}`);
                            const pubDate = await fetchDateFromCrossref(doi);
                            if (pubDate) {
                                console.log(`Fetched date ${pubDate} for DOI ${doi}`);
                                newAuthor.publicationDate = pubDate;
                            } else {
                                console.log(`No date found for DOI ${doi}`);
                            }
                        }
                        await newAuthor.save();
                        newRecords++;
                    }
                }

            } else {
                // Update existing record
                let changed = false;
                if (!existing.doi && doi) {
                    existing.doi = doi;
                    changed = true;
                }
                if (!existing.link && link) {
                    existing.link = link;
                    changed = true;
                }
                // Only update citations if the CSV has MORE citations than what's currently in DB
                if (citations > existing.citedBy) {
                    existing.citedBy = citations;
                    changed = true;
                }
                // Fetch and set publication date if missing
                if (!existing.publicationDate && doi) {
                    const pubDate = await fetchDateFromCrossref(doi);
                    if (pubDate) { existing.publicationDate = pubDate; changed = true; }
                }

                if (changed) {
                    await existing.save();
                    updatedRecords++;
                }
            }
        }
        console.log(`Finished ${file}: Added ${newRecords} new records, updated ${updatedRecords} existing records.`);
    }

    mongoose.disconnect();
}

importCsvs();
