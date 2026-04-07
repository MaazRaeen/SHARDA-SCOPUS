require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const ShardaAuthor = require('./models/ShardaAuthor');

async function fetchScopusData(query, apiKey) {
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

async function startMigration() {
    console.log('Starting Publication Date Migration...');

    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    }

    const apiKey = process.env.SCOPUS_API_KEY;
    if (!apiKey) {
        console.error('No Scopus API key found in .env');
        process.exit(1);
    }

    // Find all distinct DOIs that don't have a publicationDate yet
    const distinctDois = await ShardaAuthor.distinct('doi', {
        doi: { $ne: '', $exists: true },
        publicationDate: { $exists: false }
    });

    if (distinctDois.length === 0) {
        console.log('No papers found missing publication dates.');
        process.exit(0);
    }

    console.log(`Found ${distinctDois.length} distinct DOIs to process.`);

    const BATCH_SIZE = 25;
    let updatedCount = 0;
    let totalProcessed = 0;

    for (let i = 0; i < distinctDois.length; i += BATCH_SIZE) {
        const batch = distinctDois.slice(i, i + BATCH_SIZE);
        const query = batch.map(d => `DOI("${d}")`).join(' OR ');

        try {
            const data = await fetchScopusData(query, apiKey);
            const entries = data['search-results']?.entry || [];

            if (entries.length > 0 && !entries[0].error) {
                for (const entry of entries) {
                    const doi = entry['prism:doi'];
                    const coverDate = entry['prism:coverDate']; // Format: YYYY-MM-DD

                    if (doi && coverDate) {
                        const dateObj = new Date(coverDate);
                        if (!isNaN(dateObj.getTime())) {
                            const result = await ShardaAuthor.updateMany(
                                { doi: doi },
                                { $set: { publicationDate: dateObj } }
                            );
                            updatedCount += result.modifiedCount;
                        }
                    }
                }
            }
            totalProcessed += batch.length;
            console.log(`Processed: ${totalProcessed}/${distinctDois.length} | Updated: ${updatedCount} records`);
        } catch (err) {
            console.error(`Error on batch starting at index ${i}:`, err.message);
        }

        // Delay to respect rate limits
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Migration completed! Total records updated with publication dates: ${updatedCount}`);
    process.exit(0);
}

startMigration();
