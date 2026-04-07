require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function checkDoi() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const doi = "10.1016/j.matpr.2021.05.470";
        const authors = await ShardaAuthor.find({ doi: doi });

        console.log(`Found ${authors.length} records for DOI: ${doi}`);
        authors.forEach(a => {
            console.log(`- Author: ${a.authorName}, Dept: ${a.department}`);
        });

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkDoi();
