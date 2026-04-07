const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');

async function check() {
    try {
        const mongoUri = process.env.MONGODB_URI;
        await mongoose.connect(mongoUri);

        const authorCount = await ShardaAuthor.countDocuments();
        const uniquePapers = await ShardaAuthor.distinct('paperTitle');

        console.log('Total ShardaAuthor records:', authorCount);
        console.log('Total Unique Paper Titles:', uniquePapers.length);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
