const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const xlsx = require('xlsx');

// 1. Get Faculty List
console.log("Loading Faculty List...");
const workbook = xlsx.readFile(path.join(__dirname, 'uploads', 'Combined Faculty list.xlsx'));
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const facultyData = xlsx.utils.sheet_to_json(sheet);

// Build Set of Normalized CSE Faculty Names
const cseFacultyNames = new Set(
    facultyData
        .filter(t => t.Department && t.Department.toLowerCase().includes('computer science'))
        .map(t => {
            const name = t.Name || t['Faculty Name'] || '';
            return name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '').trim();
        })
        .filter(n => n.length > 0)
);
console.log(`Loaded ${cseFacultyNames.size} distinct CSE Faculty names from Excel.`);

// Normalize Name Function
function normalizeName(name) {
    if (!name) return '';
    if (name.includes(',')) {
        const parts = name.split(',');
        return `${parts[1].trim()} ${parts[0].trim()}`.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '').trim();
    }
    return name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '').trim();
}

async function verifyCounts() {
    const csvPath = path.join(__dirname, 'uploads', '1771611839176-926921650.csv');
    console.log(`Analyzing CSV: ${csvPath}`);

    const masterCSEAuthorIDs = new Set();
    const cseAuthorsFound = [];
    let totalPapersAnalyzed = 0;

    // PASS 1: Find Unique CSE Author IDs
    await new Promise((resolve) => {
        fs.createReadStream(csvPath)
            .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/[-\s]+/g, '_') }))
            .on('data', (row) => {
                const authorsText = row.authors_with_affiliations || '';
                const idsText = row.authors_id || '';

                // Needs to have Sharda in it somewhere
                if (!authorsText.toLowerCase().includes('sharda')) return;

                const authorEntries = authorsText.split(';').map(a => a.trim()).filter(a => a);
                const authorIds = idsText.split(';').map(id => id.trim()).filter(id => id);

                for (let i = 0; i < authorEntries.length; i++) {
                    const entry = authorEntries[i];
                    const scopusId = authorIds[i];
                    if (!scopusId) continue;

                    const lowerEntry = entry.toLowerCase();
                    if (!lowerEntry.includes('sharda')) continue;

                    // Extract name part (before the comma separating affiliation)
                    let authorName = entry;
                    if (entry.includes(',')) {
                        // Rough extraction: assume name is up to the first affiliation keyword or just take the first part
                        authorName = entry.split(',')[0].trim();
                        // Handle "Surname, Firstname, Affiliation" if present
                        if (entry.split(',').length > 2 && !entry.split(',')[1].toLowerCase().includes('university') && !entry.split(',')[1].toLowerCase().includes('department')) {
                            authorName = `${entry.split(',')[0].trim()}, ${entry.split(',')[1].trim()}`;
                        }
                    }

                    let isCSE = false;
                    let reason = '';

                    // CHECK A: Keyword Match (Must not be CSA)
                    if (
                        (lowerEntry.includes('computer science') || lowerEntry.includes(' cse ') || lowerEntry.includes('computer eng') || lowerEntry.includes('comp. sci'))
                        && !lowerEntry.includes('application') && !lowerEntry.includes('csa')
                    ) {
                        isCSE = true;
                        reason = 'Keyword Match (Check A)';
                    }
                    // CHECK B: Faculty Match (If generic SSET/Engineering/Sharda)
                    else {
                        const normalizedAuthorName = normalizeName(authorName);
                        if (cseFacultyNames.has(normalizedAuthorName)) {
                            // Verify they have SOME Sharda engineering/generic affiliation
                            if (lowerEntry.includes('school of engineering') || lowerEntry.includes('sset') || lowerEntry.includes('sharda')) {
                                isCSE = true;
                                reason = 'Faculty List Match (Check B)';
                            }
                        }
                    }

                    if (isCSE && !masterCSEAuthorIDs.has(scopusId)) {
                        masterCSEAuthorIDs.add(scopusId);
                        cseAuthorsFound.push({ id: scopusId, name: authorName, reason });
                    }
                }
            })
            .on('end', resolve);
    });

    console.log(`\n--- Verification Phase 1 ---`);
    console.log(`Found ${masterCSEAuthorIDs.size} Unique CSE Authors. (User expected ~1,235)`);

    // PASS 2: Count Papers with at least one CSE Author ID
    let finalPaperCount = 0;
    const verifiedDoiSet = new Set();
    const verifiedTitleSet = new Set();

    await new Promise((resolve) => {
        fs.createReadStream(csvPath)
            .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/[-\s]+/g, '_') }))
            .on('data', (row) => {
                const authorsText = row.authors_with_affiliations || '';
                const idsText = row.authors_id || '';
                const title = row.title || '';
                const doi = row.doi || '';

                if (!authorsText.toLowerCase().includes('sharda') || !title) return;

                const authorIds = idsText.split(';').map(id => id.trim()).filter(id => id);

                // Does this paper have at least one CSE Author ID?
                const hasCSEAuthor = authorIds.some(id => masterCSEAuthorIDs.has(id));

                if (hasCSEAuthor) {
                    // Check for Duplicates (Website Dashboard groups by Title/DOI)
                    const uniquenessKey = (doi || title).toLowerCase().trim();
                    if (uniquenessKey && !verifiedTitleSet.has(uniquenessKey) && !verifiedTitleSet.has(title)) {
                        finalPaperCount++;
                        verifiedTitleSet.add(uniquenessKey);
                        if (title) verifiedTitleSet.add(title);
                    }
                }
            })
            .on('end', resolve);
    });

    console.log(`\n--- Verification Phase 2 ---`);
    console.log(`Found ${finalPaperCount} total unique papers authored by the master CSE list. (User expected ~2,949)`);
}

verifyCounts().catch(console.error);
