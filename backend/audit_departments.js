const mongoose = require('mongoose');
const xlsx = require('xlsx');
require('dotenv').config();

const ShardaAuthor = require('./models/ShardaAuthor');
const { matchNames, standardizeDepartment } = require('./utils/nameMatcher');

const EXCEL_PATH = '/Users/arghadeep/Downloads/Sharda_copy-main 2/backend/uploads/Combined Faculty list.xlsx';

async function audit() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_db');
        console.log('Connected to DB.');

        // Read Excel
        const workbook = xlsx.readFile(EXCEL_PATH);
        const excelData = xlsx.utils.sheet_to_json(workbook.Sheets['Sheet1']);
        console.log(`Loaded ${excelData.length} faculty from Excel.`);

        // Build a surname index for faster matching
        const surnameIndex = {};
        excelData.forEach(f => {
            if (!f.Name) return;
            const parts = f.Name.toLowerCase().split(/\s+/);
            const surname = parts[parts.length - 1];
            if (!surnameIndex[surname]) surnameIndex[surname] = [];
            surnameIndex[surname].push(f);
        });

        // Get unique authors from DB
        const dbAuthors = await ShardaAuthor.aggregate([
            { $group: { _id: '$authorName', department: { $first: '$department' } } }
        ]);
        console.log(`Found ${dbAuthors.length} unique authors in DB.`);

        const mismatches = [];
        const noMatches = [];

        console.log('Starting optimized audit...');
        for (const auth of dbAuthors) {
            const dbName = auth._id;
            const dbDept = auth.department;
            if (!dbName) continue;

            // Extract surname from DB name to narrow down search
            const dbParts = dbName.toLowerCase().split(/\s+/);
            const dbSurname = dbParts[dbParts.length - 1];

            const candidates = surnameIndex[dbSurname] || [];

            // Find in candidates
            const facultyMatch = candidates.find(f => matchNames(f.Name, dbName));

            if (facultyMatch) {
                const excelDept = standardizeDepartment(facultyMatch['Dept.']);
                const currentDept = standardizeDepartment(dbDept);

                if (excelDept !== currentDept && excelDept !== 'NA' && currentDept !== 'NA') {
                    if (excelDept.toLowerCase() !== currentDept.toLowerCase()) {
                        mismatches.push({
                            name: dbName,
                            excelName: facultyMatch.Name,
                            dbDept: dbDept,
                            excelDept: excelDept
                        });
                    }
                }
            } else {
                noMatches.push(dbName);
            }
        }

        console.log('\n=== AUDIT RESULTS ===');
        console.log(`Mismatches found: ${mismatches.length}`);

        // Group by Excel Dept for better summary
        const byExcelDept = {};
        mismatches.forEach(m => {
            if (!byExcelDept[m.excelDept]) byExcelDept[m.excelDept] = [];
            byExcelDept[m.excelDept].push(m);
        });

        for (const dept in byExcelDept) {
            console.log(`\n--- Target: ${dept} ---`);
            byExcelDept[dept].forEach(m => {
                console.log(`[MISMATCH] ${m.name} (Excel: ${m.excelName}) | Current DB Dept: ${m.dbDept}`);
            });
        }

        console.log(`\nAuthors not found in Excel: ${noMatches.length}`);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

audit();
