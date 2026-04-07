const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { standardizeDepartment, matchNamesStrict } = require('./utils/nameMatcher');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const teachers = await Teacher.find({}).lean();
    console.log(`Loaded ${teachers.length} teachers for matching...`);

    const allRecords = await ShardaAuthor.find({}).lean();
    console.log(`Processing ${allRecords.length} records...`);

    // Build a map of teacher names for fast lookup
    const teacherMap = {};
    teachers.forEach(t => {
        const clean = t.name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        teacherMap[clean] = t;
    });

    const updates = [];
    const csePapers = new Set();
    const csePaperDetails = [];

    for (const r of allRecords) {
        let department = r.department;
        let isSharda = r.isSharda;
        let authorName = r.authorName;

        // 1. Standardize Department
        const stdDept = standardizeDepartment(r.department);

        // 2. Teacher Match Re-Verification
        const cleanName = authorName.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        const match = teacherMap[cleanName];

        if (match) {
            isSharda = true;
            if (stdDept === 'NA') {
                department = standardizeDepartment(match.department);
            } else {
                department = stdDept;
            }
        } else {
            department = stdDept;
        }

        if (department !== r.department || isSharda !== r.isSharda) {
            updates.push({
                updateOne: {
                    filter: { _id: r._id },
                    update: { $set: { department, isSharda } }
                }
            });
        }

        // Identify CSE papers (Sharda authors in CSE/CSA)
        if (isSharda && (department === 'Department of Computer Science & Engineering' || department === 'Department of Computer Science & Applications' || department === 'Department of Electrical Electronics & Communication Engineering')) {
            csePapers.add(`${(r.paperTitle || '').trim().toLowerCase()}|${r.year}|${(r.doi || '').trim().toLowerCase()}`);
        }
    }

    console.log(`Ready to perform ${updates.push} updates... (dry run for now)`);
    console.log(`CSE-related Sharda Papers (grouped by Title+Year+DOI): ${csePapers.size}`);

    // Total Paper count by Title+Year+DOI
    const totalPapers = new Set();
    allRecords.forEach(r => {
        totalPapers.add(`${(r.paperTitle || '').trim().toLowerCase()}|${r.year}|${(r.doi || '').trim().toLowerCase()}`);
    });
    console.log(`Total unique papers (Title+Year+DOI): ${totalPapers.size}`);

    process.exit(0);
}

run().catch(console.error);
