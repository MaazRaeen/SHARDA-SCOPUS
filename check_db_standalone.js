const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://debnatharghadeep_db_user:55X157tzDnw74upN@excel07.gstx8hy.mongodb.net/?appName=Excel07';

const shardaAuthorSchema = new mongoose.Schema({
    authorName: String,
    department: String,
    paperTitle: String,
    year: Number,
    keywords: [String],
    countries: [String]
});

const ShardaAuthor = mongoose.model('ShardaAuthor', shardaAuthorSchema);

async function checkDb() {
    try {
        console.log('Connecting to remote DB...');
        await mongoose.connect(MONGODB_URI);
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
                if (anySample) {
                    console.log('Sample record keys:', Object.keys(anySample.toObject()));
                    console.log('Sample record paperTitle:', anySample.paperTitle);
                }
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkDb();
