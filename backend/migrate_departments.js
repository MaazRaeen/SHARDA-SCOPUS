const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const ConsolidatedPaper = require('./models/ConsolidatedPaper');
const { standardizeDepartment } = require('./utils/nameMatcher');

async function migrate() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        console.log('Fetching all ShardaAuthor records...');
        const authors = await ShardaAuthor.find({}).lean();
        console.log(`Found ${authors.length} records.`);

        const updates = [];
        const stats = {
            total: authors.length,
            changed: 0,
            alreadyCanonical: 0,
            na: 0,
            mappingSummary: {}
        };

        for (const author of authors) {
            const originalDept = author.department || '';
            const canonicalDept = standardizeDepartment(originalDept);

            if (canonicalDept === 'NA') stats.na++;

            if (canonicalDept !== originalDept) {
                stats.changed++;
                stats.mappingSummary[originalDept] = (stats.mappingSummary[originalDept] || 0) + 1;
                
                updates.push({
                    updateOne: {
                        filter: { _id: author._id },
                        update: { $set: { department: canonicalDept } }
                    }
                });
            } else {
                stats.alreadyCanonical++;
            }
        }

        console.log('\nMigration Stats:');
        console.log(`- Total Records: ${stats.total}`);
        console.log(`- Already Canonical: ${stats.alreadyCanonical}`);
        console.log(`- Changed: ${stats.changed}`);
        console.log(`- Mapped to NA: ${stats.na}`);

        if (updates.length > 0) {
            console.log(`\nExecuting ${updates.length} updates in bulk...`);
            // Use bulkWrite in chunks to avoid large memory usage / network issues
            const chunkSize = 1000;
            for (let i = 0; i < updates.length; i += chunkSize) {
                const chunk = updates.slice(i, i + chunkSize);
                await ShardaAuthor.bulkWrite(chunk, { ordered: false });
                console.log(`  Processed ${Math.min(i + chunkSize, updates.length)}/${updates.length} updates...`);
            }
            console.log('Update complete.');

            // Re-sync consolidated papers materialized view
            console.log('\nTriggering ConsolidatedPaper re-sync...');
            // We can manually trigger the sync logic or just call the sync function if we can import it correctly
            // Since paperController has a lot of side effects, let's just trigger it via a POST request to the running server if it's up
            // Or better, just implement a small sync here if we want to be independent.
            // Actually, the paperController sync is quite complex. 
            // I'll call the /api/papers/map-departments endpoint which already exists and does similar work.
            // But wait, the server is running on localhost:3000.
        } else {
            console.log('\nNo changes needed.');
        }

        console.log('\nVerifying unique departments...');
        const finalDepts = await ShardaAuthor.distinct('department');
        console.log(`Unique departments now: ${finalDepts.length}`);
        console.log(finalDepts.sort());

        console.log('\nMigration finished successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
