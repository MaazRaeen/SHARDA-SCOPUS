const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB.');
        const controller = require('./controllers/paperController');
        
        // Mock req and res objects
        const req = {
            params: {
                name: 'Rohit Kumar Sachan' // Test name-based resolution
            }
        };
        
        const res = {
            json: (data) => {
                console.log('API Response Successful!');
                console.log('Author Name:', data.name);
                console.log('Department:', data.department);
                console.log('Total Papers (calculated):', data.totalPapers);
                console.log('Total Citations (calculated):', data.totalCitations);
                console.log('H-Index (calculated):', data.hIndex);
                console.log('Co-Authors (official):', data.coauthorCount);
                console.log('Yearly Stats:', data.yearlyStats);
                console.log('Quartiles Distribution:', data.quartiles);
                console.log('Validation Report:', JSON.stringify(data.validation, null, 2));
                console.log('Number of Papers returned:', data.papers?.length);
                if (data.papers && data.papers.length > 0) {
                    console.log('Sample Paper fields:', Object.keys(data.papers[0]));
                    console.log('Sample Paper:', JSON.stringify(data.papers[0], null, 2));
                }
                console.log('Official Profile:', JSON.stringify(data.officialProfile, null, 2));
                mongoose.disconnect();
                process.exit(0);
            },
            status: (code) => {
                console.log('HTTP Status Code:', code);
                return res;
            },
            send: (msg) => {
                console.log('HTTP Response Send:', msg);
                mongoose.disconnect();
                process.exit(1);
            }
        };

        console.log('Invoking getAuthorStats...');
        await controller.getAuthorStats(req, res);
    })
    .catch(err => {
        console.error('Connection failed:', err);
        process.exit(1);
    });
