require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const totalCount = await ShardaAuthor.countDocuments();
        const withDate = await ShardaAuthor.countDocuments({
            publicationDate: { $exists: true, $ne: null, $ne: '' }
        });
        const withDoi = await ShardaAuthor.countDocuments({
            doi: { $exists: true, $ne: null, $ne: '' }
        });

        console.log(`Total papers in DB: ${totalCount}`);
        console.log(`Papers WITH a DOI: ${withDoi}`);
        console.log(`Papers WITH a publication date: ${withDate}`);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        mongoose.disconnect();
    }
})();
