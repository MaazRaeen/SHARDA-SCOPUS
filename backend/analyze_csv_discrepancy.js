const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

async function analyzeCSV(filePath) {
    const papers = [];
    const missingSharda = [];
    const duplicates = [];
    const seen = new Map();

    console.log(`Analyzing ${filePath}...`);

    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv({
                mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/[-\s]+/g, '_')
            }))
            .on('data', (row) => {
                const title = row.title || row.paper_title || "";
                const authorsWithAffiliation = row.authors_with_affiliations || "";
                const doi = row.doi || "";
                const year = row.year || "";
                const source = row.source_title || "";

                if (!title) return;

                // 1. Check for Sharda in affiliation
                if (!authorsWithAffiliation.toLowerCase().includes('sharda')) {
                    missingSharda.push({ title, doi, year });
                }

                // 2. Check for duplicates
                const uniquenessKey = (doi || title).toLowerCase().trim();
                const PaperKey = `${title}|${year}|${source}|${doi}`.toLowerCase().trim();

                if (seen.has(PaperKey)) {
                    duplicates.push({ title, doi, year, reason: 'Duplicate Metadata' });
                } else {
                    seen.set(PaperKey, row);
                }
            })
            .on('end', () => {
                console.log(`\n--- ANALYSIS RESULTS ---`);
                console.log(`Total Rows with Titles: ${seen.size + duplicates.length}`);
                console.log(`Total without Sharda: ${missingSharda.length}`);
                console.log(`Total Duplicates merged: ${duplicates.length}`);

                console.log(`\n--- SAMPLE MISSING SHARDA ---`);
                missingSharda.slice(0, 10).forEach(p => console.log(`- ${p.title} (${p.year}) [DOI: ${p.doi}]`));
                if (missingSharda.length > 10) console.log(`... and ${missingSharda.length - 10} more`);

                console.log(`\n--- SAMPLE DUPLICATES ---`);
                duplicates.slice(0, 10).forEach(p => console.log(`- ${p.title} (${p.year})`));
                if (duplicates.length > 10) console.log(`... and ${duplicates.length - 10} more`);

                resolve({ missingSharda, duplicates });
            })
            .on('error', reject);
    });
}

// Use one of the recent uploads
const csvPath = path.join(__dirname, 'uploads/1771611839176-926921650.csv');
analyzeCSV(csvPath).catch(err => console.error(err));
