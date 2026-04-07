const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { standardizeDepartment } = require('./utils/nameMatcher');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB.');

        // 1. Standardize Teacher Collection
        console.log('Standardizing Teacher collection...');
        const teachers = await Teacher.find({}).lean();
        const teacherUpdates = [];

        teachers.forEach(t => {
            const std = standardizeDepartment(t.department);
            if (std !== t.department) {
                teacherUpdates.push({
                    updateOne: {
                        filter: { _id: t._id },
                        update: { $set: { department: std } }
                    }
                });
            }
        });

        if (teacherUpdates.length > 0) {
            await Teacher.bulkWrite(teacherUpdates);
            console.log(`Updated ${teacherUpdates.length} teachers.`);
        } else {
            console.log('No teachers needed updating.');
        }

        // 2. Standardize ShardaAuthor Collection
        console.log('Standardizing ShardaAuthor collection...');
        const authors = await ShardaAuthor.find({}).lean();
        const authorUpdates = [];

        authors.forEach(a => {
            const std = standardizeDepartment(a.department);
            if (std !== a.department) {
                authorUpdates.push({
                    updateOne: {
                        filter: { _id: a._id },
                        update: { $set: { department: std } }
                    }
                });
            }
        });

        if (authorUpdates.length > 0) {
            const batchSize = 1000;
            for (let i = 0; i < authorUpdates.length; i += batchSize) {
                const batch = authorUpdates.slice(i, i + batchSize);
                await ShardaAuthor.bulkWrite(batch);
                console.log(`Updated ${Math.min(i + batch.length, authorUpdates.length)} authors...`);
            }
            console.log(`Successfully updated total ${authorUpdates.length} authors.`);
        } else {
            console.log('No authors needed updating.');
        }

        console.log('Migration complete.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

run();
