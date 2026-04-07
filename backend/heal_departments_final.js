const mongoose = require('mongoose');
const xlsx = require('xlsx');
require('dotenv').config();

const ShardaAuthor = require('./models/ShardaAuthor');
const { matchNames, standardizeDepartment } = require('./utils/nameMatcher');

const EXCEL_PATH = '/Users/arghadeep/Downloads/Sharda_copy-main 2/backend/uploads/Combined Faculty list.xlsx';

async function heal() {
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
        const dbAuthorNames = await ShardaAuthor.distinct('authorName');
        console.log(`Found ${dbAuthorNames.length} unique author names in DB.`);

        let updatedAuthors = 0;
        let totalRecordsAffected = 0;

        console.log('Starting total healing process...');
        for (const dbName of dbAuthorNames) {
            if (!dbName) continue;

            // Extract surname from DB name to narrow down search
            const dbParts = dbName.toLowerCase().split(/\s+/);
            const dbSurname = dbParts[dbParts.length - 1];

            const candidates = surnameIndex[dbSurname] || [];

            // Find in candidates
            const facultyMatch = candidates.find(f => matchNames(f.Name, dbName));

            if (facultyMatch) {
                const targetDept = standardizeDepartment(facultyMatch['Dept.']);

                if (targetDept && targetDept !== 'NA') {
                    // Update all documents for this authorName in ShardaAuthor
                    // Even if some are already correct, this ensures consistency
                    const result = await ShardaAuthor.updateMany(
                        { authorName: dbName, department: { $ne: targetDept } },
                        { $set: { department: targetDept } }
                    );

                    if (result.modifiedCount > 0) {
                        console.log(`[HEALED] ${dbName} -> ${targetDept} (${result.modifiedCount} records updated)`);
                        updatedAuthors++;
                        totalRecordsAffected += result.modifiedCount;
                    }
                }
            }
        }

        console.log('\n=== HEALING SUMMARY ===');
        console.log(`Authors with updated records: ${updatedAuthors}`);
        console.log(`Total paper records corrected: ${totalRecordsAffected}`);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

heal();
