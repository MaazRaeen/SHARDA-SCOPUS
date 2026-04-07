const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const { syncConsolidatedPapers, clearAnalyticsCache, propagateDepartments } = require('./controllers/paperController');

async function fixBhupinder() {
    console.log('Starting Targeted Fix for Bhupinder Singh...');
    await mongoose.connect(process.env.MONGODB_URI);

    // 1. Direct update in shardaauthors
    const result = await ShardaAuthor.updateMany(
        { authorName: 'Bhupinder Singh' },
        { $set: { department: 'Department of Law' } }
    );

    console.log(`✅ Updated ${result.modifiedCount} records in ShardaAuthor for Bhupinder Singh to Department of Law.`);

    // 2. Clear Cache
    console.log('Clearing Analytics Cache...');
    if (typeof clearAnalyticsCache === 'function') {
        clearAnalyticsCache();
    } else {
        console.warn('clearAnalyticsCache is not available, skipping.');
    }

    // 3. Propagate & Sync
    console.log('Starting Propagation and Sync...');
    const propagated = await propagateDepartments();
    console.log(`Propagated to ${propagated} papers.`);

    await syncConsolidatedPapers();
    console.log('🚀 All Sync and Post-processing Complete.');
    process.exit(0);
}

fixBhupinder().catch(err => {
    console.error('Targeted Fix failed:', err);
    process.exit(1);
});
