require('dotenv').config({ path: './backend/.env' });
const mongoose = require('mongoose');
const ShardaAuthor = require('./backend/models/ShardaAuthor');

async function checkDb() {
    try {
        console.log('Connecting to:', process.env.MONGODB_URI ? 'URI FOUND' : 'URI MISSING');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const total = await ShardaAuthor.countDocuments();
        console.log('Total ShardaAuthor records:', total);

        const withKeywords = await ShardaAuthor.countDocuments({ keywords: { $exists: true, $not: { $size: 0 } } });
        console.log('Records with keywords:', withKeywords);

        if (total > 0) {
            const sample = await ShardaAuthor.findOne({ keywords: { $exists: true, $not: { $size: 0 } } });
            if (sample) {
                console.log('Sample record with keywords FOUND');
                console.log('Keywords:', sample.keywords);
            } else {
                console.log('No records with keywords found in whole DB.');
                const anySample = await ShardaAuthor.findOne();
                console.log('Sample record keys:', Object.keys(anySample.toObject()));
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkDb();
