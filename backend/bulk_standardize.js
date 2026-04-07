const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { standardizeDepartment } = require('./utils/nameMatcher');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const teachers = await Teacher.find({}).lean();
    console.log(`Loaded ${teachers.length} teachers.`);

    const teacherMap = {};
    teachers.forEach(t => {
        const clean = t.name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        teacherMap[clean] = t;
    });

    const allRecords = await ShardaAuthor.find({}).lean();
    console.log(`Standardizing ${allRecords.length} records...`);

    const bulkOps = [];
    let processed = 0;

    for (const r of allRecords) {
        let department = r.department;
        let isSharda = r.isSharda;

        // Standardize
        const stdDept = standardizeDepartment(r.department);
        const cleanName = (r.authorName || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        const match = teacherMap[cleanName];

        let newDept = stdDept;
        let newIsSharda = isSharda;

        if (match) {
            newIsSharda = true;
            if (stdDept === 'NA' || !stdDept) {
                newDept = standardizeDepartment(match.department);
            }
        }

        if (newDept !== r.department || newIsSharda !== r.isSharda) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: r._id },
                    update: { $set: { department: newDept, isSharda: newIsSharda } }
                }
            });
        }

        processed++;
        if (bulkOps.length >= 1000) {
            await ShardaAuthor.bulkWrite(bulkOps);
            console.log(`Updated ${processed}/${allRecords.length} records...`);
            bulkOps.length = 0;
        }
    }

    if (bulkOps.length > 0) {
        await ShardaAuthor.bulkWrite(bulkOps);
    }

    console.log('Standardization complete!');
    process.exit(0);
}

run().catch(console.error);
