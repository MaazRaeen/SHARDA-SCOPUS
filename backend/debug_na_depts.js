const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { matchNames } = require('./utils/nameMatcher');

async function debugNA() {
    try {
        const mongoUri = process.env.MONGODB_URI;
        await mongoose.connect(mongoUri);

        console.log('Finding authors with department: NA...');
        const naAuthors = await ShardaAuthor.find({ department: 'NA' }).limit(50);
        console.log(`Found ${naAuthors.length} authors with NA (limited to 50).`);

        const teachers = await Teacher.find({}).lean();
        console.log(`Loaded ${teachers.length} teachers.`);

        let matchesFound = 0;
        for (const author of naAuthors) {
            const match = teachers.find(t => matchNames(t.name, author.authorName));
            if (match) {
                console.log(`[MATCH FOUND] Author: "${author.authorName}" matches Teacher: "${match.name}" (Dept: ${match.department})`);
                matchesFound++;
            } else {
                // console.log(`[NO MATCH] Author: "${author.authorName}"`);
            }
        }

        console.log(`\nSummary: Out of 50 sampled NA authors, ${matchesFound} have potential matches in the Teacher list.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugNA();
