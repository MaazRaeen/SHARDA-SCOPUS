require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const ConsolidatedPaper = require('./models/ConsolidatedPaper');

async function sync() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');
        console.log('Connected.');

        console.log('Loading authors...');
        const authors = await ShardaAuthor.find({}).lean();
        console.log(`Loaded ${authors.length} authors.`);

        const paperMap = new Map();

        for (const a of authors) {
            let paperId = null;
            const link = a.link || '';
            const eidMatch = link.match(/eid=([^&]+)/);
            if (eidMatch) {
                paperId = `eid|${eidMatch[1]}`;
            } else if (a.doi && a.doi.trim()) {
                paperId = `doi|${a.doi.trim().toLowerCase()}`;
            } else {
                paperId = `${(a.paperTitle || '').trim().toLowerCase()}|${a.year || ''}`;
            }

            if (!paperMap.has(paperId)) {
                paperMap.set(paperId, {
                    _id: paperId,
                    paperTitle: a.paperTitle,
                    year: a.year,
                    sourcePaper: a.sourcePaper,
                    publisher: a.publisher,
                    doi: a.doi,
                    paperType: a.paperType,
                    link: a.link,
                    quartile: a.quartile,
                    citedBy: a.citedBy || 0,
                    publicationDate: a.publicationDate,
                    countries: a.countries,
                    keywords: a.keywords,
                    authors: []
                });
            }

            const p = paperMap.get(paperId);
            p.citedBy = Math.max(p.citedBy, a.citedBy || 0);
            p.authors.push({
                authorName: a.authorName,
                department: a.department,
                isSharda: a.isSharda,
                email: a.email,
                scopusId: a.scopusId
            });
        }

        const consolidated = Array.from(paperMap.values());
        console.log(`Grouped into ${consolidated.length} consolidated papers.`);

        console.log('Clearing old consolidated papers...');
        await ConsolidatedPaper.deleteMany({});
        
        console.log('Inserting new consolidated papers...');
        const chunkSize = 1000;
        for (let i = 0; i < consolidated.length; i += chunkSize) {
            await ConsolidatedPaper.insertMany(consolidated.slice(i, i + chunkSize), { ordered: false });
            console.log(`  - Inserted ${Math.min(i + chunkSize, consolidated.length)}/${consolidated.length}`);
        }

        console.log('Sync complete.');
        process.exit(0);
    } catch (err) {
        console.error('Error during sync:', err);
        process.exit(1);
    }
}

sync();
