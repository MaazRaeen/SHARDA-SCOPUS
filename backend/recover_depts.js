const mongoose = require('mongoose');
const fs = require('fs');
const csv = require('csv-parser');
require('dotenv').config();

const Teacher = require('./models/Teacher');
const { matchNames, standardizeDepartment } = require('./utils/nameMatcher');

const CSV_PATH = '/Users/arghadeep/Downloads/scopus_export_Feb 10-2026_e3ade3ad-cee4-498d-943d-b9289e362d0c.csv';

async function recover() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB.');

    const teachers = await Teacher.find({}).lean();
    console.log(`Loaded ${teachers.length} teachers.`);

    const corrections = new Map(); // TeacherID -> NewDept

    const stream = fs.createReadStream(CSV_PATH).pipe(csv());

    for await (const row of stream) {
        const affiliations = row['Affiliations'] || '';
        const authorsWithAffiliations = row['Authors with affiliations'] || '';

        // Split authors with affiliations
        const parts = authorsWithAffiliations.split(';').map(p => p.trim());

        for (const part of parts) {
            if (part.toLowerCase().includes('sharda')) {
                // Extract author name (before the first comma if it exists in the part)
                // Actually the format is "Surname, First, Affiliation" or "First Last, Affiliation"
                // Usually it's "Name, Affiliation"
                const commaIndex = part.indexOf(',');
                if (commaIndex === -1) continue;

                const name = part.substring(0, commaIndex).trim();
                const aff = part.substring(commaIndex + 1).trim();

                if (aff.toLowerCase().includes('sharda')) {
                    const standardized = standardizeDepartment(aff);

                    // We only care about recovering things that might have been lost
                    if (standardized === 'Mass Communication' || standardized === 'Computer Science & Applications') {
                        // Find matching teacher
                        const matched = teachers.find(t => matchNames(t.name, name));
                        if (matched) {
                            // If teacher currently has EECE or CSE, and we found Mass Comm or CSA, prioritize the specific one
                            if (matched.department === 'Electrical Electronics & Communication Engineering' ||
                                matched.department === 'Computer Science & Engineering' ||
                                matched.department === 'Business and Commerce') {
                                corrections.set(matched._id.toString(), standardized);
                            }
                        }
                    }
                }
            }
        }
    }

    console.log(`Identified ${corrections.size} corrections.`);

    let updatedCount = 0;
    for (const [id, newDept] of corrections) {
        await Teacher.updateOne({ _id: id }, { $set: { department: newDept } });
        updatedCount++;
    }

    console.log(`Updated ${updatedCount} teachers.`);
    process.exit(0);
}

recover().catch(err => {
    console.error(err);
    process.exit(1);
});
