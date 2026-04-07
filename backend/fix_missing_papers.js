require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const csv = require('csv-parser');

async function fixMissingPapers() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');

    // 1. Get all papers currently in DB
    const dbPapersArray = await ShardaAuthor.aggregate([
        { $group: { _id: "$paperTitle" } }
    ]);

    const dbPapers = new Set();
    dbPapersArray.forEach(p => {
        if (p._id) {
            dbPapers.add(String(p._id).toLowerCase().replace(/[^a-z0-9]/g, ''));
        }
    });

    // 2. Read CitationOverview to find the exact 41 missing papers
    const overviewContent = fs.readFileSync('uploads/CitationOverview (1).csv', 'utf-8');
    const overviewLines = overviewContent.split('\n');

    let headerIdx = -1;
    for (let i = 0; i < Math.min(20, overviewLines.length); i++) {
        if (overviewLines[i].startsWith('Publication Year')) {
            headerIdx = i;
            break;
        }
    }

    const missingTitlesFromOverview = new Map(); // normalized -> { originalTitle, expectedCitations }
    for (let i = headerIdx + 1; i < overviewLines.length; i++) {
        const line = overviewLines[i].trim();
        if (!line) continue;

        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        if (parts.length < 5) continue;

        let title = parts[1];
        if (title && title.startsWith('"') && title.endsWith('"')) {
            title = title.substring(1, title.length - 1);
        }

        const normTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        let totalCitesStr = parts[parts.length - 1];
        if (totalCitesStr && totalCitesStr.startsWith('"')) totalCitesStr = totalCitesStr.replace(/"/g, '');
        let totalCites = parseInt(totalCitesStr, 10);

        if (!isNaN(totalCites) && !dbPapers.has(normTitle)) {
            missingTitlesFromOverview.set(normTitle, { title, totalCites });
        }
    }

    console.log(`Identified ${missingTitlesFromOverview.size} exactly missing papers from CitationOverview.`);

    // 3. Scan the new Scopus Export CSV for these missing papers
    const newCsvFile = 'uploads/scopus_export_Feb 18-2026_dbb7fdc0-08f2-4b53-be69-a3da39dbfa90.csv';
    console.log(`Scanning ${newCsvFile} for the missing papers...`);

    const rows = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(newCsvFile)
            .pipe(csv())
            .on('data', (data) => rows.push(data))
            .on('end', resolve)
            .on('error', reject);
    });

    let addedCount = 0;
    let citationsRecovered = 0;

    for (const row of rows) {
        const keys = Object.keys(row);
        const titleCol = keys.find(k => k.toLowerCase().includes('title') && !k.toLowerCase().includes('source'));
        if (!titleCol) continue;

        const title = row[titleCol]?.trim();
        if (!title) continue;

        const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (missingTitlesFromOverview.has(normTitle)) {
            // We found one of the missing papers! Add it to the DB.
            const expectedData = missingTitlesFromOverview.get(normTitle);

            const doiCol = keys.find(k => k.toLowerCase() === 'doi');
            const linkCol = keys.find(k => k.toLowerCase().includes('link'));
            const yearCol = keys.find(k => k.toLowerCase() === 'year');
            const sourceCol = keys.find(k => k.toLowerCase().includes('source') || k.toLowerCase().includes('journal'));
            const typeCol = keys.find(k => k.toLowerCase().includes('type'));
            const publisherCol = keys.find(k => k.toLowerCase().includes('publisher'));
            const citationsCol = keys.find(k => k.toLowerCase().includes('cited'));
            const authorsCol = keys.find(k => k.toLowerCase() === 'authors');

            const doi = row[doiCol]?.trim() || '';
            const link = row[linkCol]?.trim() || '';
            let year = parseInt(row[yearCol]);
            year = isNaN(year) ? null : year;
            const source = row[sourceCol]?.trim() || '';
            const type = row[typeCol]?.trim() || '';
            const publisher = row[publisherCol]?.trim() || '';
            let citations = parseInt(row[citationsCol]);
            citations = isNaN(citations) ? expectedData.totalCites : citations;

            let firstAuthor = 'Unknown Author';
            if (authorsCol && row[authorsCol]) {
                firstAuthor = row[authorsCol].split(',')[0].trim();
            }

            const newAuthor = new ShardaAuthor({
                authorName: firstAuthor,
                department: 'NA',
                paperTitle: expectedData.title, // use the clean overview title
                year: year,
                sourcePaper: source,
                publisher: publisher,
                paperType: type,
                doi: doi,
                link: link,
                citedBy: citations,
                countries: []
            });

            await newAuthor.save();
            addedCount++;
            citationsRecovered += citations;
            missingTitlesFromOverview.delete(normTitle); // don't add it twice
            console.log(`  -> Recovered: ${expectedData.title.substring(0, 50)}... (+${citations} cites)`);
        }
    }

    console.log(`\nFinished scanning. Added ${addedCount} missing papers, recovering ${citationsRecovered} citations.`);

    if (missingTitlesFromOverview.size > 0) {
        console.log(`WARNING: ${missingTitlesFromOverview.size} papers were STILL not found in the new CSV.`);
        // let's print a couple
        const stillMissing = Array.from(missingTitlesFromOverview.values()).slice(0, 5);
        console.log("For example:", stillMissing.map(m => m.title).join(" | "));
    }

    // 4. Recalculate Total Citations
    const finalCitations = await ShardaAuthor.aggregate([
        {
            $group: {
                _id: "$paperTitle",
                citedBy: { $first: "$citedBy" }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: "$citedBy" }
            }
        }
    ]);

    console.log(`\n=== FINAL DB TOTAL CITATIONS: ${finalCitations[0]?.total || 0} ===\n`);

    process.exit(0);
}

fixMissingPapers();
