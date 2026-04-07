const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(err));

const paperController = require('./controllers/paperController');

// Add a mock response interface for the modified express controller signature
async function testDirect() {
    try {
        const result = await paperController.getAnalytics(undefined, undefined, undefined);
        console.log("Response parsed: Topics array length:", result.data.topicEvolution.length);
        console.log(JSON.stringify(result.data.topicEvolution[0], null, 2));
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}

// Wait connection
setTimeout(() => {
    testDirect();
}, 3000);
