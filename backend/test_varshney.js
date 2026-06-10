const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const Teacher = require('./models/Teacher');
        const ShardaAuthor = require('./models/ShardaAuthor');
        
        console.log('--- Teacher details matching Varshney ---');
        const teachers = await Teacher.find({ name: /Varshney/i }).lean();
        console.log(teachers);

        console.log('\n--- Unique Scopus IDs in ShardaAuthor for Varshney ---');
        const uniqueIds = await ShardaAuthor.distinct('scopusId', { authorName: /Varshney/i });
        console.log(uniqueIds);

        console.log('\n--- Local paper counts in ShardaAuthor for Varshney ---');
        const localCount = await ShardaAuthor.countDocuments({ authorName: /Varshney/i });
        console.log('Total local papers matching regex /Varshney/i:', localCount);

        // Run the controller stats for "Varshney S."
        const controller = require('./controllers/paperController');
        const req = { params: { name: 'Varshney S.' } };
        const res = {
            json: (data) => {
                console.log('\n--- API Output for "Varshney S." ---');
                console.log('Name:', data.name);
                console.log('Department:', data.department);
                console.log('Calculated Total Papers:', data.totalPapers);
                console.log('Calculated Citations:', data.totalCitations);
                console.log('Calculated H-Index:', data.hIndex);
                console.log('Co-Authors (official):', data.coauthorCount);
                console.log('Official Profile:', data.officialProfile);
                console.log('Validation:', data.validation);
                mongoose.disconnect();
                process.exit(0);
            },
            status: () => res,
            send: () => { mongoose.disconnect(); process.exit(1); }
        };
        await controller.getAuthorStats(req, res);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
