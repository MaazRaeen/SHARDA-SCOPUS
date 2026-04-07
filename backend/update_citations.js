require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const ShardaAuthor = require('./models/ShardaAuthor');

async function fetchScopusCitations(query, apiKey) {
    return new Promise((resolve, reject) => {
        const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(query)}&count=25&apiKey=${apiKey}`;

        https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', e => reject(e));
    });
}

async function updateCitations() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');
    console.log('Connected to MongoDB');

    const apiKey = process.env.SCOPUS_API_KEY;
    if (!apiKey) {
        console.error('No Scopus API key found');
        process.exit(1);
    }

    // Find all distinct DOIs that are not empty
    const distinctDois = await ShardaAuthor.distinct('doi', { doi: { $ne: '', $exists: true } });
    console.log(`Found ${distinctDois.length} distinct DOIs to fetch.`);

    const BATCH_SIZE = 25; // Scopus search max count is 25 per page
    let updatedCount = 0;

    for (let i = 0; i < distinctDois.length; i += BATCH_SIZE) {
        const batch = distinctDois.slice(i, i + BATCH_SIZE);
        const query = batch.map(d => `DOI("${d}")`).join(' OR ');

        try {
            const data = await fetchScopusCitations(query, apiKey);
            const entries = data['search-results']?.entry || [];

            if (entries.length > 0 && !entries[0].error) {
                for (const entry of entries) {
                    const doi = entry['prism:doi'];
                    const countsStr = entry['citedby-count'];
                    if (doi && countsStr) {
                        const counts = parseInt(countsStr, 10);
                        if (!isNaN(counts)) {
                            const r = await ShardaAuthor.updateMany(
                                { doi: doi },
                                { $set: { citedBy: counts } }
                            );
                            updatedCount += r.modifiedCount;
                        }
                    }
                }
            }
            console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(distinctDois.length / BATCH_SIZE)}. Total DB records updated: ${updatedCount}`);
        } catch (err) {
            console.error(`Error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err.message);
        }

        // Rate limit delay ~ 200ms
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Finished updating citations! ${updatedCount} records modified.`);
    process.exit(0);
}

updateCitations();
