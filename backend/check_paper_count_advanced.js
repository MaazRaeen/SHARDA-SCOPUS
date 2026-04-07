const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');

async function check() {
    try {
        const mongoUri = process.env.MONGODB_URI;
        await mongoose.connect(mongoUri);

        const allRecords = await ShardaAuthor.find({}).lean();

        const uniquePapers = new Set(allRecords.map(r => {
            return [
                r.paperTitle,
                r.year,
                r.sourcePaper,
                r.publisher,
                r.doi,
                r.link,
                r.paperType
            ].join('|');
        }));

        console.log('Total ShardaAuthor records:', allRecords.length);
        console.log('Total Unique Papers (Analytics Logic):', uniquePapers.size);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
