const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { standardizeDepartment } = require('./utils/nameMatcher');

async function fixDepartments() {
    console.log('Starting Department Correction Sweep...');
    await mongoose.connect(process.env.MONGODB_URI);

    const teachers = await Teacher.find({ isActive: true }).lean();
    console.log(`Loaded ${teachers.length} active teachers.`);

    // Create a normalized map for matching
    const teacherMap = {};
    const strictNormalize = (n) => n.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '').trim();

    teachers.forEach(t => {
        const key = strictNormalize(t.name);
        teacherMap[key] = t.department;
    });

    const authors = await ShardaAuthor.find({}).lean();
    console.log(`Checking ${authors.length} author records...`);

    const bulkOps = [];
    let updatedCount = 0;

    for (const author of authors) {
        const key = strictNormalize(author.authorName);
        const targetDept = teacherMap[key];

        if (targetDept) {
            const normalizedTargetDept = targetDept.startsWith('Department of') ? targetDept : `Department of ${targetDept}`;

            if (author.authorName === 'Bhupinder Singh') {
                console.log(`[TARGET MATCH] Bhupinder Singh | Current: ${author.department} | Target: ${normalizedTargetDept}`);
            }

            if (author.department !== normalizedTargetDept) {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: author._id },
                        update: { $set: { department: normalizedTargetDept } }
                    }
                });
                updatedCount++;
            }
        }

        if (bulkOps.length >= 1000) {
            await ShardaAuthor.bulkWrite(bulkOps);
            console.log(`Processed ${bulkOps.length} updates...`);
            bulkOps.length = 0;
        }
    }

    if (bulkOps.length > 0) {
        await ShardaAuthor.bulkWrite(bulkOps);
    }

    console.log(`✅ Correction complete. Updated ${updatedCount} records.`);
    process.exit(0);
}

fixDepartments().catch(err => {
    console.error('Correction failed:', err);
    process.exit(1);
});
