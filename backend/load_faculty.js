const mongoose = require('mongoose');
const xlsx = require('xlsx');
const path = require('path');
require('dotenv').config();

// Load models
const Teacher = require('./models/Teacher');

const EXCEL_PATH = '/Users/arghadeep/Downloads/Sharda_copy-main 2/backend/uploads/Combined Faculty list.xlsx';

async function loadFaculty() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_db';
        console.log('Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('Connected.');

        // Read Excel
        console.log(`Reading Excel from: ${EXCEL_PATH}`);
        const workbook = xlsx.readFile(EXCEL_PATH);
        const sheetName = 'Sheet1';
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            throw new Error(`Sheet "${sheetName}" not found in Excel file.`);
        }

        const data = xlsx.utils.sheet_to_json(sheet);
        console.log(`Found ${data.length} rows in Sheet1.`);

        const teachers = [];
        data.forEach((row, index) => {
            // Normalizing headers based on our discovery
            const name = row['Name'];
            const empId = row['Emp Id'];
            const dept = row['Dept.'];
            const school = row['School'];

            if (!name) {
                console.log(`Skipping row ${index + 2}: Missing Name.`);
                return;
            }

            // Assign NA if department is missing, or try to recover from School
            let finalDept = dept ? String(dept).trim() : '';
            if (!finalDept && school) {
                finalDept = String(school).trim();
            }
            if (!finalDept) finalDept = 'NA';

            teachers.push({
                teacherId: empId ? String(empId).trim() : `AUTO_${name.replace(/\s+/g, '_')}`,
                name: String(name).trim(),
                department: finalDept,
                designation: school ? String(school).trim() : undefined, // Using school as designation/meta for now
                isActive: true
            });
        });

        console.log(`Preparing to upsert ${teachers.length} teachers...`);

        const operations = teachers.map(t => ({
            updateOne: {
                filter: { teacherId: t.teacherId }, // Matching by teacherId is precise
                update: { $set: t },
                upsert: true
            }
        }));

        if (operations.length > 0) {
            const result = await Teacher.bulkWrite(operations);
            console.log('Bulk write complete:', result);
        }

        console.log('Migration finished successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

loadFaculty();
