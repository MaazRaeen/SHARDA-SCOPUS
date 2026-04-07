const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { matchNames } = require('./utils/nameMatcher');

async function heal() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('Fetching Teachers and ShardaAuthor records...');
        const [teachers, authors] = await Promise.all([
            Teacher.find({}).lean(),
            ShardaAuthor.find({}).lean()
        ]);
        console.log(`Loaded ${teachers.length} teachers and ${authors.length} author records.`);

        // 1. Build a map of authorName -> Most specific department from existing ShardaAuthors (Cross-Paper)
        const authorDeptMap = {};
        authors.forEach(record => {
            const name = record.authorName;
            const dept = record.department;
            if (name && dept && dept !== 'NA' && dept !== 'Unspecified' && dept.trim() !== '') {
                if (!authorDeptMap[name]) authorDeptMap[name] = dept;
            }
        });

        // 2. Identify records that need healing
        const updates = [];
        let teacherHealed = 0;
        let crossPaperHealed = 0;

        authors.forEach(record => {
            if (!record.department || record.department === 'NA' || record.department === 'Unspecified') {
                let healedDept = null;

                const isValidDept = (d) => {
                    if (!d) return false;
                    const lower = d.toLowerCase().trim();
                    return lower !== 'na' && lower !== 'unspecified' && lower !== 'null' && lower !== '';
                };

                // Try Teacher match first (Higher Priority)
                const matchedTeacher = teachers.find(t => matchNames(t.name, record.authorName));
                if (matchedTeacher && isValidDept(matchedTeacher.department)) {
                    healedDept = matchedTeacher.department;
                    teacherHealed++;
                }
                // Then try Cross-Paper Recovery
                else if (authorDeptMap[record.authorName]) {
                    healedDept = authorDeptMap[record.authorName];
                    crossPaperHealed++;
                }

                if (healedDept) {
                    updates.push({
                        updateOne: {
                            filter: { _id: record._id },
                            update: { $set: { department: healedDept } }
                        }
                    });
                }
            }
        });

        console.log(`Identified ${updates.length} records to heal (${teacherHealed} from Teachers, ${crossPaperHealed} from Cross-Paper).`);

        if (updates.length > 0) {
            const batchSize = 500;
            for (let i = 0; i < updates.length; i += batchSize) {
                const batch = updates.slice(i, i + batchSize);
                await ShardaAuthor.bulkWrite(batch);
                console.log(`Healed ${Math.min(i + batch.length, updates.length)}/${updates.length} records...`);
            }
            console.log('Healing complete.');
        } else {
            console.log('No records required healing.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Error during healing:', err);
        process.exit(1);
    }
}

heal();
