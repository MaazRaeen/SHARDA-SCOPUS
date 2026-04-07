const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const allRecords = await ShardaAuthor.find({}).lean();

    // 1. Group papers by Title + Year + DOI + Link
    const paperMap = new Map();
    allRecords.forEach(r => {
        const key = `${(r.paperTitle || '').trim().toLowerCase()}|${r.year}|${(r.doi || '').trim().toLowerCase()}|${(r.link || '').trim().toLowerCase()}`;
        if (!paperMap.has(key)) {
            paperMap.set(key, { title: r.paperTitle, year: r.year, doi: r.doi, link: r.link, count: 0 });
        }
        paperMap.get(key).count++;
    });
    console.log('Unique Papers (Title+Year+DOI+Link):', paperMap.size);

    // 2. Identify duplicates by Title + DOI (regardless of year/link)
    const titleDoiMap = new Map();
    paperMap.forEach((val, key) => {
        const tdKey = `${val.title.trim().toLowerCase()}|${(val.doi || '').trim().toLowerCase()}`;
        if (val.doi) {
            if (!titleDoiMap.has(tdKey)) titleDoiMap.set(tdKey, []);
            titleDoiMap.get(tdKey).push(val);
        }
    });

    const duplicates = [];
    titleDoiMap.forEach((list, key) => {
        if (list.length > 1) {
            duplicates.push({ key, variations: list });
        }
    });

    console.log('Duplicate groups (based on Title+DOI with differing Year/Link):', duplicates.length);
    if (duplicates.length > 0) {
        console.log('Sample Duplicates:');
        duplicates.slice(0, 5).forEach(d => {
            console.log(`  Key: ${d.key}`);
            d.variations.forEach(v => console.log(`    - Year: ${v.year}, Link: ${v.link}`));
        });
    }

    // 3. CSE Count after standardization
    const csePapers = new Set();
    const cseDepts = [
        'Department of Computer Science & Engineering',
        'Department of Computer Science & Applications',
        'Department of Electrical Electronics & Communication Engineering'
    ];

    allRecords.forEach(r => {
        if (r.isSharda && cseDepts.includes(r.department)) {
            csePapers.add(`${(r.paperTitle || '').trim().toLowerCase()}|${r.year}|${(r.doi || '').trim().toLowerCase()}`);
        }
    });
    console.log('Final CSE/CSA/EECE Paper Count:', csePapers.size);

    process.exit(0);
}

run().catch(console.error);
