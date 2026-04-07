require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function findPaper() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const partialTitle = "Hopfield associative memory";
        const paper = await ShardaAuthor.findOne({ paperTitle: { $regex: new RegExp(partialTitle, 'i') } });

        if (paper) {
            console.log('Paper found:');
            console.log(JSON.stringify(paper, null, 2));
        } else {
            console.log('Paper not found in database.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

findPaper();
