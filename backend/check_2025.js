require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        for (const year of [2024, 2025, 2026, 2027]) {
            const raw = await ShardaAuthor.countDocuments({ year: year, department: /computer science/i });
            const papers = await ShardaAuthor.find({ year: year, department: /computer science/i }).lean();
            const unique = new Set(papers.map(r => [r.paperTitle, r.year, r.sourcePaper, r.publisher, r.doi, r.link, r.paperType].join('|')));
            console.log(`Year ${year}: Raw=${raw}, Unique=${unique.size}`);
        }
    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
run();
