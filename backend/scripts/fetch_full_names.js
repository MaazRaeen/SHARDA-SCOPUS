const mongoose = require('mongoose');
const https = require('https');
require('dotenv').config();
const ShardaAuthor = require('../models/ShardaAuthor');

// Scopus API settings
const API_KEY = process.env.SCOPUS_API_KEY;
const DELAY_MS = 250; // Rate limiting: ~4 requests per second

async function fetchAuthorName(scopusId) {
    return new Promise((resolve) => {
        const url = `https://api.elsevier.com/content/author/author_id/${scopusId}?view=LIGHT&apiKey=${API_KEY}`;
        const options = {
            headers: { 'Accept': 'application/json' }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        const profile = json['author-retrieval-response']?.[0];
                        if (profile && profile['preferred-name']) {
                            const { surname, 'given-name': givenName } = profile['preferred-name'];
                            // Build full name
                            let fullName = '';
                            if (givenName) fullName += givenName + ' ';
                            if (surname) fullName += surname;
                            resolve(fullName.trim());
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                } else if (res.statusCode === 429) {
                    console.log(`Rate limit hit for ${scopusId}. Waiting...`);
                    resolve('RETRY');
                } else {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

async function start() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        // Find all unique scopusIds where isFullName is false
        const uniqueIds = await ShardaAuthor.distinct('scopusId', { 
            scopusId: { $exists: true, $ne: "" },
            $or: [{ isFullName: false }, { isFullName: { $exists: false } }]
        });
        console.log(`Found ${uniqueIds.length} unique Scopus IDs needing full name fetch.`);

        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;

        for (let i = 0; i < uniqueIds.length; i++) {
            const sid = uniqueIds[i];
            
            // Check if we already have a full name for this sid in one of the records
            // For now, assume any name without a comma and with space might be "full" enough?
            // Actually, let's just fetch everything to be sure.
            
            process.stdout.write(`[${i + 1}/${uniqueIds.length}] SID: ${sid} -> `);

            const fullName = await fetchAuthorName(sid);

            if (fullName === 'RETRY') {
                i--; // retry current
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            if (fullName) {
                // Update all authors with this scopusId
                await ShardaAuthor.updateMany({ scopusId: sid }, { $set: { authorName: fullName, isFullName: true } });
                console.log(`Success: ${fullName}`);
                successCount++;
            } else {
                console.log('Not Found or Error');
                // Even on fail, mark so we dont retry forever? Or leave as false to retry?
                // Let's mark as "failed to fetch" or similar?
                // For now, mark as true so we skip this ID in future iterations of this session.
                await ShardaAuthor.updateMany({ scopusId: sid }, { $set: { isFullName: true } });
                failCount++;
            }

            // Rate limit
            await new Promise(r => setTimeout(r, DELAY_MS));
        }

        console.log('\nMigration Summary:');
        console.log(`- Success: ${successCount}`);
        console.log(`- Failed: ${failCount}`);
        console.log(`- Cumulative: ${successCount + failCount}`);

        console.log('\nTriggering re-sync of ConsolidatedPaper materialized view...');
        // Imported in some other scripts or we can run the sync script
        process.exit(0);
    } catch (e) {
        console.error('Fatal Error:', e);
        process.exit(1);
    }
}

start();
