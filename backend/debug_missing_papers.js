const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const stream = require('stream');
require('dotenv').config();

// Load models and utils
const Teacher = require('./models/Teacher');
const { matchNames, formatAuthorName, standardizeDepartment } = require('./utils/nameMatcher');

// Configuration
const CSV_PATH = '/Users/arghadeep/Downloads/scopus_export_Feb 10-2026_e3ade3ad-cee4-498d-943d-b9289e362d0c.csv';
const SHARDA_KEYWORD = 'sharda';

// --- EXACT COPY OF UPDATED LOGIC FROM paperController.js ---
const extractShardaAuthors = (entries, paperData, teacherIndex, globalDeptMap = {}) => {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const results = [];
    const seenPairs = new Set();
    const { sourcePaper, publisher, paperTitle } = paperData;
    const { surnameMap, normalizedMap } = teacherIndex;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry || typeof entry !== 'string') continue;

        const lowerEntry = entry.toLowerCase();
        const containsSharda = lowerEntry.includes(SHARDA_KEYWORD);

        // Retention Rule: ONLY keep if affiliation explicitly contains Sharda
        // This check is good.
        // if (!containsSharda) continue; // REMOVED FOR DEBUGGING

        const parts = entry.split(',').map(p => p.trim()).filter(p => p);
        if (parts.length === 0) continue;

        let authorName = '';
        let department = '';
        const len = parts.length;

        if (len >= 2) {
            if (len >= 3) {
                authorName = formatAuthorName(`${parts[0]}, ${parts[1]}`);
                const potentialDepts = [];
                const deptKeywords = ['department', 'dept', 'school', 'centre', 'center', 'faculty', 'division', 'college', 'institute'];
                const institutionKeywords = ['university', 'univ', 'academy', 'limited', 'ltd', 'hospital', 'vidyapeeth'];
                const locations = ['india', 'u.p.', 'u.p', 'up', 'uttar pradesh', 'greater noida', 'noida', 'delhi', 'new delhi', 'lucknow'];

                for (let j = 2; j < len; j++) {
                    const part = parts[j];
                    const lowerPart = part.toLowerCase();
                    if (locations.includes(lowerPart) || locations.some(loc => lowerPart === loc)) continue;
                    const isExternalInst = institutionKeywords.some(k => lowerPart.includes(k)) &&
                        !deptKeywords.some(k => lowerPart.includes(k));
                    if (isExternalInst && !lowerPart.includes('sharda')) continue;
                    potentialDepts.push(part);
                }

                if (potentialDepts.length > 0) {
                    department = standardizeDepartment(potentialDepts.join(', '));
                }
            } else if (len === 2) {
                authorName = formatAuthorName(`${parts[0]}, ${parts[1]}`);
            } else {
                authorName = parts[0];
            }
        } else if (len === 1) {
            authorName = parts[0];
        }

        if (!authorName) continue;

        const isValidDept = (d) => {
            if (!d) return false;
            const lower = d.toLowerCase().trim();
            return lower !== 'na' && lower !== 'unspecified' && lower !== 'null' && lower !== '';
        };

        let matchedTeacher = null;
        const cleanName = authorName.toLowerCase().replace(/[^\w\s]/g, '');

        if (normalizedMap[cleanName]) {
            matchedTeacher = normalizedMap[cleanName];
        } else {
            const nameParts = cleanName.split(/\s+/);
            const surname = nameParts[nameParts.length - 1];
            const candidates = surnameMap[surname] || [];
            matchedTeacher = candidates.find(t => matchNames(t.name, authorName));
            if (!matchedTeacher && nameParts.length > 1) {
                const firstSurname = nameParts[0];
                const firstCandidates = surnameMap[firstSurname] || [];
                matchedTeacher = firstCandidates.find(t => matchNames(t.name, authorName));
            }
        }

        // DEBUG LOGIC
        if (!containsSharda && matchedTeacher) {
            console.log(`  [FOUND MATCH WITHOUT KEYWORD] Entry: "${entry}"`);
            console.log(`    -> Matched Teacher: ${matchedTeacher.name} (${matchedTeacher.department})`);
        }

        if (!containsSharda && !matchedTeacher) continue; // Skip if neither keyword nor match

        let finalDepartment = ''; // Priority 0: Empty

        // 1. Paper Affiliation (CSV) - PRIMARY SOURCE OF TRUTH
        if (isValidDept(department)) {
            finalDepartment = department;
        }

        // 2. Teacher Directory (Fallback)
        if (!isValidDept(finalDepartment) && matchedTeacher && isValidDept(matchedTeacher.department)) {
            finalDepartment = matchedTeacher.department;
        }

        // Default 'NA'
        department = isValidDept(finalDepartment) ? standardizeDepartment(finalDepartment) : 'NA';

        const pairKey = `${authorName.toLowerCase()}|${(department || '').toLowerCase()}`;
        if (seenPairs.has(pairKey)) continue;

        seenPairs.add(pairKey);
        results.push({ authorName, department });
    }

    return results;
};


async function debug() {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MONGODB_URI not found in env');

        await mongoose.connect(mongoUri);
        console.log('Connected to DB.');

        // Build Teacher Index
        const teachers = await Teacher.find({}).lean();
        const surnameMap = {};
        const normalizedMap = {};
        for (const t of teachers) {
            if (!t.name) continue;
            const cleanName = t.name.toLowerCase().replace(/[^\w\s]/g, '');
            normalizedMap[cleanName] = t;
            const parts = cleanName.split(/\s+/);
            const surname = parts[parts.length - 1];
            if (!surnameMap[surname]) surnameMap[surname] = [];
            surnameMap[surname].push(t);
            if (parts.length > 1) {
                const first = parts[0];
                if (!surnameMap[first]) surnameMap[first] = [];
                surnameMap[first].push(t);
            }
        }
        const teacherIndex = { surnameMap, normalizedMap };

        if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found at: ${CSV_PATH}`);
        const fileBuffer = fs.readFileSync(CSV_PATH);

        let processedPapers = 0;
        let missingPapers = 0;
        let columnIndices = {};

        const bufferStream = new stream.PassThrough();
        bufferStream.end(fileBuffer);

        console.log('Scanning for papers with 0 Sharda Authors...');

        await new Promise((resolve, reject) => {
            bufferStream
                .pipe(csv({
                    mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/[-\s]+/g, '_')
                }))
                .on('data', (row) => {
                    if (processedPapers === 0) {
                        const keys = Object.keys(row);
                        columnIndices = {
                            title: keys.findIndex(k => k === 'title' || k.includes('title')),
                            authors: keys.findIndex(k => k.includes('author') && k.includes('affiliation')),
                        };
                    }
                    processedPapers++;

                    const values = Object.values(row);
                    const title = values[columnIndices.title];
                    const authorsWithAff = values[columnIndices.authors];

                    // Try to find "Authors" column (names only)
                    const keys = Object.keys(row); // Re-get keys for authorsOnlyIndex
                    const authorsOnlyIndex = keys.findIndex(k => k === 'authors' || (k.includes('author') && !k.includes('affiliation') && !k.includes('id')));
                    const authorsOnly = authorsOnlyIndex >= 0 ? values[authorsOnlyIndex] : '';

                    if (!authorsWithAff) return;

                    const authorEntries = parseAuthorEntries(authorsWithAff);
                    const extracted = extractShardaAuthors(authorEntries, { paperTitle: title }, teacherIndex, {});

                    if (extracted.length === 0) {
                        missingPapers++;
                        console.log(`\n[MISSING #${missingPapers}] Paper: "${title}"`);
                        console.log(`  -> "Authors with affiliations" Length: ${authorsWithAff.length}`);
                        console.log(`  -> Ends with "...": ${authorsWithAff.trim().endsWith('...')}`);

                        // Check if any teacher is in the "Authors Only" column
                        if (authorsOnly) {
                            console.log(`  -> "Authors Only" Column Length: ${authorsOnly.length}`);
                            let foundInNamesOnly = 0;
                            const names = authorsOnly.split(/[;,]/).map(n => n.trim());
                            for (const name of names) {
                                const clean = name.toLowerCase().replace(/[^\w\s]/g, '');
                                if (Object.values(teacherIndex.normalizedMap).some(t => matchNames(t.name, name))) {
                                    // Optimization: blindly scanning 2000 teachers is slow, but OK for 5 papers
                                    // actually logic above is better
                                    const parts = clean.split(/\s+/);
                                    const surname = parts[parts.length - 1];
                                    const candidates = teacherIndex.surnameMap[surname] || [];
                                    const match = candidates.find(t => matchNames(t.name, name));
                                    if (match) {
                                        if (foundInNamesOnly < 3) console.log(`      -> Potential Match in Names Only: ${name} (Matched: ${match.name})`);
                                        foundInNamesOnly++;
                                    }
                                }
                            }
                            if (foundInNamesOnly > 0) console.log(`  -> Found ${foundInNamesOnly} teachers in "Authors Only" column! Truncation likely.`);
                        }
                        // Check if specific keywords exist in raw text
                        const hasSharda = authorsWithAff.toLowerCase().includes('sharda');
                        console.log(`  -> Contains "sharda" in AuthorsWithAff? ${hasSharda}`);

                        // Check generic "Affiliations" column
                        const affIndex = keys.findIndex(k => k === 'affiliations');
                        const affRaw = affIndex >= 0 ? values[affIndex] : '';
                        const affHasSharda = affRaw.toLowerCase().includes('sharda');
                        console.log(`  -> Contains "sharda" in Generic Affiliations Column? ${affHasSharda}`);
                        if (affHasSharda) {
                            console.log(`  -> [CRITICAL] Sharda is in Affiliations but not linked to specific author!`);
                            console.log(`  -> Affiliations Raw: "${affRaw}"`);
                        }

                        // Print the raw entries that ALMOST matched (containing 'sharda' but failed extraction logic)
                        console.log(`  -> Raw Entries with keyword 'sharda':`);
                        authorEntries.forEach(entry => {
                            if (entry.toLowerCase().includes('sharda')) {
                                console.log(`      - "${entry}"`);
                            }
                        });
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`\nScan Complete. Found ${missingPapers} papers with 0 Sharda authors out of ${processedPapers}.`);
        process.exit(0);
    } catch (err) {
        console.error('Debug failed:', err);
        process.exit(1);
    }
}

// Helper from Controller
function parseAuthorEntries(raw) {
    if (!raw) return [];
    // Basic semicolon split, assuming standard Scopus format
    return raw.split(';').map(a => a.trim()).filter(a => a);
}

debug();
