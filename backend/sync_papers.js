const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const stream = require('stream');
require('dotenv').config();

// Load models and utils
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const Paper = require('./models/Paper');
const { matchNames, matchNamesStrict, formatAuthorName, standardizeDepartment } = require('./utils/nameMatcher');

// Configuration
const CSV_PATH = '/Users/arghadeep/Downloads/scopus_export_Feb 10-2026_e3ade3ad-cee4-498d-943d-b9289e362d0c.csv';
const SHARDA_KEYWORD = 'sharda';

const extractShardaAuthors = (entries, paperData, teachers = [], globalDeptMap = {}) => {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const results = [];
    const seenPairs = new Set();

    for (let entry of entries) {
        if (!entry || typeof entry !== 'string') continue;

        // Format of entry: "Author Name, Affiliation 1, Affiliation 2..."
        const parts = entry.split(',').map(p => p.trim()).filter(p => p);
        if (parts.length === 0) continue;

        // Fix: Extract both Surname and First Name
        let authorNameRaw = parts[0];
        if (parts.length >= 2) {
            authorNameRaw = `${parts[0]}, ${parts[1]}`;
        }
        const affiliation = entry.toLowerCase();
        const isShardaAffiliated = affiliation.includes(SHARDA_KEYWORD);

        // Match against Teacher list
        const matchedTeacher = teachers.find(t => matchNames(t.name, authorNameRaw));

        // CRITICAL: Only keep authors explicitly affiliated with Sharda University
        if (!isShardaAffiliated) continue;

        const authorName = formatAuthorName(authorNameRaw);
        let department = '';

        // Extract department from current author's affiliation
        if (parts.length >= 2) {
            const potentialDepts = [];
            const institutionKeywords = ['university', 'univ', 'academy', 'limited', 'ltd', 'hospital', 'vidyapeeth'];
            const deptKeywords = ['department', 'dept', 'school', 'centre', 'center', 'faculty', 'division', 'college', 'institute'];
            const locations = ['india', 'u.p.', 'u.p', 'up', 'uttar pradesh', 'greater noida', 'noida', 'delhi', 'new delhi', 'lucknow'];

            for (let j = 1; j < parts.length; j++) {
                const part = parts[j];
                const lowerPart = part.toLowerCase();
                if (locations.includes(lowerPart)) continue;

                // If it's an institution but doesn't mention sharda, skip it
                const isExternalInst = institutionKeywords.some(k => lowerPart.includes(k)) && !deptKeywords.some(k => lowerPart.includes(k));
                if (isExternalInst && !lowerPart.includes('sharda')) continue;

                potentialDepts.push(part);
            }
            if (potentialDepts.length > 0) {
                department = standardizeDepartment(potentialDepts.join(', '));
            }
        }

        const isValidDept = (d) => {
            if (!d) return false;
            const lower = d.toLowerCase().trim();
            return lower !== 'na' && lower !== 'unspecified' && lower !== 'null' && lower !== '';
        };

        // Priority Check for final department:
        let finalDepartment = '';

        // 1. Paper Affiliation (CSV) - PRIMARY SOURCE OF TRUTH
        if (isValidDept(department)) {
            finalDepartment = department;
        }

        // 2. Teacher Directory (Strict Fallback)
        const matchedTeacherStrict = teachers.find(t => matchNamesStrict(t.name, authorNameRaw));
        if (!isValidDept(finalDepartment) && matchedTeacherStrict && isValidDept(matchedTeacherStrict.department)) {
            finalDepartment = matchedTeacherStrict.department;
        }

        // 3. Cross-Paper Recovery (Last Resort)
        if (!isValidDept(finalDepartment) && globalDeptMap[authorName]) {
            finalDepartment = globalDeptMap[authorName];
        }

        const resolvedDept = isValidDept(finalDepartment) ? standardizeDepartment(finalDepartment) : 'NA';

        const pairKey = `${authorName.toLowerCase()}|${resolvedDept.toLowerCase()}|${paperData.paperTitle.toLowerCase()}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        results.push({
            ...paperData,
            authorName,
            department: resolvedDept
        });
    }
    return results;
};

async function sync() {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MONGODB_URI not found in env');

        await mongoose.connect(mongoUri);
        console.log('Connected to DB.');
        const teachers = await Teacher.find({}).lean();
        console.log(`Loaded ${teachers.length} teachers.`);

        if (!fs.existsSync(CSV_PATH)) throw new Error(`Master CSV not found at: ${CSV_PATH}`);

        const fileBuffer = fs.readFileSync(CSV_PATH);
        const authors = [];
        let processedPapers = 0;

        const bufferStream = new stream.PassThrough();
        bufferStream.end(fileBuffer);

        console.log('Processing Master Scopus CSV...');

        let columnIndices = {};

        await new Promise((resolve, reject) => {
            bufferStream
                .pipe(csv({
                    mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/[-\s]+/g, '_')
                }))
                .on('data', (row) => {
                    if (processedPapers === 0) {
                        const keys = Object.keys(row);
                        columnIndices = {
                            title: keys.findIndex(k => k.includes('title')),
                            authors: keys.findIndex(k => k.includes('author') && k.includes('affiliation')),
                            // other indices skipped for brevity in debug
                        };
                        console.log('Detected Column Indices:', columnIndices);
                        console.log('Authors Column Name:', keys[columnIndices.authors]);
                    }
                    processedPapers++;

                    const values = Object.values(row);
                    const authorsRaw = values[columnIndices.authors];
                    const title = values[columnIndices.title];

                    const authorEntries = authorsRaw ? authorsRaw.split(';').map(a => a.trim()).filter(a => a) : [];
                    const extracted = extractShardaAuthors(authorEntries, {
                        paperTitle: title,
                        sourcePaper: values[columnIndices.source] || '',
                        publisher: values[columnIndices.publisher] || '',
                        year: values[columnIndices.year],
                    }, teachers, globalDeptMap);
                })
                .on('end', resolve)
                .on('error', reject);
        });
    } catch (err) {
        console.error('Sync failed:', err);
        process.exit(1);
    }
}

sync();
