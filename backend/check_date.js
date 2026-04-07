// check_date.js
require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const TARGET_DOI = '10.1007/978-3-030-66218-9_26';
(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const author = await ShardaAuthor.findOne({ doi: TARGET_DOI });
        if (!author) {
            console.log('No record found for DOI', TARGET_DOI);
        } else {
            console.log('Record found:');
            console.log('DOI:', author.doi);
            console.log('PublicationDate:', author.publicationDate);
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        mongoose.disconnect();
    }
})();
