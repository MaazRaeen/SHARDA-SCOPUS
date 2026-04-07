require('dotenv').config({ path: './backend/.env' });
const mongoose = require('mongoose');
const ShardaAuthor = require('./backend/models/ShardaAuthor');

async function findPaper() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const title = "A neuro-genetic Hopfield associative memory (HAM) with improved noise immunity";
        const paper = await ShardaAuthor.findOne({ paperTitle: { $regex: new RegExp(title, 'i') } });

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
