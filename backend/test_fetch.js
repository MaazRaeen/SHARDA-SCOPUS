const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const ShardaAuthor = require('./models/ShardaAuthor');

        console.time('mongoFetch10k');
        const records10k = await ShardaAuthor.find({}).limit(10000).lean();
        console.timeEnd('mongoFetch10k');
        console.log(`Fetched ${records10k.length} records in 10k limit mode.`);

        console.time('mongoFetchAll');
        const allRecords = await ShardaAuthor.find({}).lean();
        console.timeEnd('mongoFetchAll');
        console.log(`Fetched ${allRecords.length} records in full mode.`);

        mongoose.disconnect();
    })
    .catch(console.error);
