const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const { standardizeDepartment } = require('./utils/nameMatcher');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const allRecords = await ShardaAuthor.find({}).lean();
    console.log('Total Records:', allRecords.length);

    // Grouping variations
    const groups = {
        titleOnly: new Set(),
        titleYear: new Set(),
        titleYearDoi: new Set(),
        titleYearDoiLink: new Set()
    };

    allRecords.forEach(r => {
        const t = (r.paperTitle || '').trim().toLowerCase();
        const y = r.year || 0;
        const d = (r.doi || '').trim().toLowerCase();
        const l = (r.link || '').trim().toLowerCase();

        groups.titleOnly.add(t);
        groups.titleYear.add(`${t}|${y}`);
        groups.titleYearDoi.add(`${t}|${y}|${d}`);
        groups.titleYearDoiLink.add(`${t}|${y}|${d}|${l}`);
    });

    console.log('Counts:');
    console.log('  Title Only:', groups.titleOnly.size);
    console.log('  Title + Year:', groups.titleYear.size);
    console.log('  Title + Year + DOI:', groups.titleYearDoi.size);
    console.log('  Title + Year + DOI + Link:', groups.titleYearDoiLink.size);

    // CSE Count
    const csePapers = new Set();
    const cseKeywords = ['computer', 'cse', 'information tech', 'software', 'artificial intelligence', 'data science', 'it', 'csa'];
    const regex = new RegExp(cseKeywords.join('|'), 'i');

    allRecords.forEach(r => {
        const std = standardizeDepartment(r.department);
        if (std.includes('Computer Science') || std.includes('Information Technology') || regex.test(r.department)) {
            csePapers.add(`${(r.paperTitle || '').trim().toLowerCase()}|${r.year}`);
        }
    });
    console.log('CSE-related papers (Title+Year):', csePapers.size);

    process.exit(0);
}

run().catch(console.error);
