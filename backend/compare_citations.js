require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function compareCitations() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');

    // Load all DB papers and their citations
    const dbPapersArray = await ShardaAuthor.aggregate([
        { $group: { _id: "$paperTitle", citedBy: { $first: "$citedBy" }, doi: { $first: "$doi" }, link: { $first: "$link" } } }
    ]);

    const dbPapers = new Map();
    dbPapersArray.forEach(p => {
        if (p._id) {
            // normalize title for matching: lower case, remove punctuation
            const normTitle = String(p._id).toLowerCase().replace(/[^a-z0-9]/g, '');
            dbPapers.set(normTitle, p);
        }
    });

    // Read CSV
    const csvContent = fs.readFileSync('uploads/CitationOverview (1).csv', 'utf-8');
    const lines = csvContent.split('\n');

    // Find header row (starts with Publication Year)
    let headerIdx = -1;
    for (let i = 0; i < Math.min(20, lines.length); i++) {
        if (lines[i].startsWith('Publication Year')) {
            headerIdx = i;
            break;
        }
    }

    if (headerIdx === -1) {
        console.log("Could not find CSV header row");
        process.exit(1);
    }

    let missingInDb = 0;
    let missingCitationsInDb = 0;
    let mismatchedCitations = [];
    let dbMissingDoiTotal = 0;

    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Use a regex to properly split by comma, ignoring commas inside quotes
        const regex = /(".*?"|[^",\s]+)(?=\s*,|\s*$)/g;
        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

        if (parts.length < 5) continue;

        const year = parts[0];
        let title = parts[1];
        if (title && title.startsWith('"') && title.endsWith('"')) {
            title = title.substring(1, title.length - 1);
        }

        const normTitleCsv = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        let totalCitesStr = parts[parts.length - 1];
        if (totalCitesStr && totalCitesStr.startsWith('"')) totalCitesStr = totalCitesStr.replace(/"/g, '');
        let totalCitesCsv = parseInt(totalCitesStr, 10);

        if (isNaN(totalCitesCsv)) continue;

        if (dbPapers.has(normTitleCsv)) {
            const dbPaper = dbPapers.get(normTitleCsv);
            const diff = totalCitesCsv - dbPaper.citedBy;
            if (diff > 0) {
                mismatchedCitations.push({
                    title: title.substring(0, 50) + "...",
                    csvTotal: totalCitesCsv,
                    dbTotal: dbPaper.citedBy,
                    diff: diff,
                    hasDoi: !!dbPaper.doi,
                    eid: dbPaper.link && dbPaper.link.includes('eid=')
                });
                if (!dbPaper.doi) dbMissingDoiTotal += diff;
            }
        } else {
            missingInDb++;
            missingCitationsInDb += totalCitesCsv;
            mismatchedCitations.push({
                title: title.substring(0, 50) + "...",
                csvTotal: totalCitesCsv,
                dbTotal: "MISSING_IN_DB",
                diff: totalCitesCsv,
                hasDoi: false,
                eid: false
            });
        }
    }

    mismatchedCitations.sort((a, b) => b.diff - a.diff);

    console.log("=== Discrepancy Analysis ===");
    console.log(`Papers in CSV not found in DB: ${missingInDb} (accounting for ${missingCitationsInDb} missing citations)`);
    console.log(`Missing DOIs account for ${dbMissingDoiTotal} missing citations among matched papers.`);
    console.log("\nTop 15 biggest discrepancies per paper:");
    console.table(mismatchedCitations.slice(0, 15));

    process.exit(0);
}

compareCitations();
