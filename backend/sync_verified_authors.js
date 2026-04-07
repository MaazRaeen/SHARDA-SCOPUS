const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

const Teacher = require('./models/Teacher');
const ShardaAuthor = require('./models/ShardaAuthor');

const SCOPUS_JSON = 'sharda_authors_output.json';
const DEPT_MAP_JSON = 'dept_map.json';

async function syncAuthors() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.');

    if (!fs.existsSync(SCOPUS_JSON)) {
        console.error(`Error: ${SCOPUS_JSON} NOT FOUND. Please run process_scopus_authors.js first.`);
        process.exit(1);
    }

    const scopusAuthors = JSON.parse(fs.readFileSync(SCOPUS_JSON, 'utf-8'));
    const deptMap = JSON.parse(fs.readFileSync(DEPT_MAP_JSON, 'utf-8'));

    console.log(`Loaded ${scopusAuthors.length} authors from Scopus data.`);
    
    const teacherUpdates = [];
    const shardaAuthorUpdates = [];
    let notFoundInTeacher = 0;
    
    for (const author of scopusAuthors) {
        const scopusId = author.authorId;
        const rawDept = author.department || '';
        
        // Normalize department
        let normalizedDept = rawDept;
        if (deptMap[rawDept]) {
            normalizedDept = deptMap[rawDept];
        } else {
            // Fuzzy match or sub-string match for department normalization
            for (const key in deptMap) {
                if (rawDept.includes(key) || key.includes(rawDept) && rawDept.length > 5) {
                    normalizedDept = deptMap[key];
                    break;
                }
            }
        }

        // 1. Prepare Teacher Update
        teacherUpdates.push({
            updateOne: {
                filter: { scopusId: scopusId },
                update: { 
                    $set: { 
                        department: normalizedDept,
                        isActive: true
                    },
                    $addToSet: { alternateNames: author.fullName }
                },
                upsert: false // We don't have teacherId, so don't upsert
            }
        });

        // 2. Prepare ShardaAuthor UpdateMany (this is tricky in bulkWrite, 
        // using updateMany action for a specific filter)
        shardaAuthorUpdates.push({
            updateMany: {
                filter: { scopusId: scopusId },
                update: { $set: { department: normalizedDept } }
            }
        });
    }

    const dryRun = process.argv.includes('--dry-run');
    if (dryRun) {
        console.log('\n[DRY RUN] Potential Updates:');
        console.log(`- Teacher updates queued: ${teacherUpdates.length}`);
        console.log(`- ShardaAuthor update-many actions queued: ${shardaAuthorUpdates.length}`);
        console.log('\nSample mapping:');
        const sample = scopusAuthors[0];
        console.log(`Author: ${sample.fullName} (${sample.authorId})`);
        console.log(`Original Scopus Dept: ${sample.department}`);
        console.log(`Normalized Dept: ${deptMap[sample.department] || 'NO_MAP_FOUND (using raw)'}`);
        process.exit(0);
    }

    console.log('Executing Teacher updates...');
    const teacherRes = await Teacher.bulkWrite(teacherUpdates);
    console.log(`Teacher Collection: ${teacherRes.modifiedCount} modified.`);

    console.log('Executing ShardaAuthor department updates...');
    const shardaRes = await ShardaAuthor.bulkWrite(shardaAuthorUpdates);
    console.log(`ShardaAuthor Collection: ${shardaRes.modifiedCount} matches across many records updated.`);

    console.log('Closing connection.');
    await mongoose.connection.close();
    console.log('Finished.');
}

syncAuthors().catch(err => {
    console.error('Error during sync:', err);
    process.exit(1);
});
