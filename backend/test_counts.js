const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');

async function checkCounts() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const cseRegex = /Computer Science.*Engineering/i;
    const csaRegex = /Computer Science.*Applications/i;
    const combinedRegex = /Computer Science.*(Engineering|Applications)/i;

    const allRecords = await ShardaAuthor.find({}).lean();

    const getCount = (regex) => {
        const groups = new Map();
        allRecords.forEach(rec => {
            if (rec.department && regex.test(rec.department)) {
                let eid = '';
                if (rec.link) {
                    const match = rec.link.match(/eid=([^&]+)/);
                    if (match) eid = match[1];
                }
                const titleKey = (rec.paperTitle || '').trim().toLowerCase();
                const yearKey = rec.year || 0;
                const doiKey = (rec.doi || '').trim().toLowerCase();
                let groupKey = eid ? `eid|${eid}` : (doiKey ? `doi|${doiKey}` : `${titleKey}|${yearKey}`);
                groups.set(groupKey, true);
            }
        });
        return groups.size;
    };

    console.log('Strict CSE (Engineering):', getCount(cseRegex));
    console.log('Strict CSA (Applications):', getCount(csaRegex));
    console.log('Combined (Engineering|Applications):', getCount(combinedRegex));

    mongoose.disconnect();
}

checkCounts();
