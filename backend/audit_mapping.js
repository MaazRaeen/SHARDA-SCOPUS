const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');
const { matchNamesStrict, standardizeDepartment } = require('./utils/nameMatcher');
const { Parser } = require('json2csv');
const fs = require('fs');
require('dotenv').config();

async function audit() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB. Starting audit...');

    const authors = await ShardaAuthor.find({}).lean();
    const teachers = await Teacher.find({}).lean();

    // Build teacher index
    const teacherMap = {};
    teachers.forEach(t => {
        const clean = t.name.toLowerCase().replace(/[^\w\s]/g, '');
        if (!teacherMap[clean]) teacherMap[clean] = [];
        teacherMap[clean].push(t);
    });

    const discrepancies = [];
    let totalChecked = 0;

    for (const author of authors) {
        totalChecked++;
        const cleanName = author.authorName.toLowerCase().replace(/[^\w\s]/g, '');
        const candidates = teacherMap[cleanName] || [];

        // Find a strict match
        const matched = candidates.find(t => matchNamesStrict(t.name, author.authorName));

        if (matched) {
            const stdAuthorDept = standardizeDepartment(author.department);
            const stdTeacherDept = standardizeDepartment(matched.department);

            if (stdAuthorDept !== stdTeacherDept && stdAuthorDept !== 'NA') {
                discrepancies.push({
                    authorName: author.authorName,
                    paperTitle: author.paperTitle,
                    assignedDept: author.department,
                    teacherDept: matched.department,
                    teacherId: matched.teacherId
                });
            }
        }
    }

    console.log(`Audit Complete. Checked ${totalChecked} authors.`);
    console.log(`Found ${discrepancies.length} potential discrepancies.`);

    if (discrepancies.length > 0) {
        console.log('\nTop 20 Discrepancies:');
        discrepancies.slice(0, 20).forEach(d => {
            console.log(`Name: ${d.authorName} | Assigned: ${d.assignedDept} | Teacher DB: ${d.teacherDept}`);
        });

        const parser = new Parser();
        const csv = parser.parse(discrepancies);
        fs.writeFileSync('./dept_discrepancies_audit.csv', csv);
        console.log(`\nFull discrepancy report saved to ./dept_discrepancies_audit.csv`);
    }

    process.exit(0);
}

audit().catch(err => {
    console.error(err);
    process.exit(1);
});
