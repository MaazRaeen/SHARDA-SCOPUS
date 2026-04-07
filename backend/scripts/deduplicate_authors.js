const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const ShardaAuthor = require('../models/ShardaAuthor');
const Teacher = require('../models/Teacher');

// Helper to generate unified key (same as in paperController.js)
const getUnifiedAuthorKey = (name, dept, email = null) => {
    if (email && email.trim()) return email.toLowerCase().trim();
    if (!name) return `unknown|${dept}`;

    const n = name.toLowerCase().replace(/[.\s]+/g, ' ').trim();
    const parts = n.split(' ').filter(p => p.length > 0);
    if (parts.length === 0) return `${name}|${dept}`;

    let surname, initials;
    if (name.includes(',')) {
        const sParts = name.split(',');
        surname = sParts[0].trim().toLowerCase();
        initials = sParts[1].trim().toLowerCase().split(/[.\s]+/).filter(i => i.length > 0).map(i => i[0]).join('');
    } else {
        surname = parts[parts.length - 1];
        initials = parts.slice(0, -1).map(p => p[0]).join('');
    }

    const cleanDept = (dept || 'NA').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${surname}_${initials}_${cleanDept}`;
};

async function deduplicate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        const teachers = await Teacher.find({}).lean();
        const teacherMap = {};
        teachers.forEach(t => {
            const key = getUnifiedAuthorKey(t.name, t.department, t.email);
            if (!teacherMap[key] || t.name.length > teacherMap[key].name.length) {
                teacherMap[key] = t;
            }
        });

        console.log(`Loaded ${teachers.length} teachers for canonical reference.`);

        const authors = await ShardaAuthor.find({});
        console.log(`Analyzing ${authors.length} author records...`);

        const groups = {};
        authors.forEach(auth => {
            const key = getUnifiedAuthorKey(auth.authorName, auth.department, auth.email);
            if (!groups[key]) groups[key] = [];
            groups[key].push(auth);
        });

        console.log(`Found ${Object.keys(groups).length} unique author identities.`);

        let updateCount = 0;
        for (const key of Object.keys(groups)) {
            const group = groups[key];

            // Determine canonical name and email
            let canonicalName = '';
            let canonicalEmail = '';
            let canonicalDept = '';

            // 1. Check if we have a teacher match for this identity
            if (teacherMap[key]) {
                canonicalName = teacherMap[key].name;
                canonicalEmail = teacherMap[key].email || '';
                canonicalDept = teacherMap[key].department;
            } else {
                // 2. Otherwise pick the "best" name from the group (longest is usually fullest)
                group.forEach(a => {
                    if (!canonicalName || a.authorName.length > canonicalName.length) {
                        canonicalName = a.authorName;
                    }
                    if (!canonicalEmail && a.email) {
                        canonicalEmail = a.email;
                    }
                    if (!canonicalDept && a.department && a.department !== 'NA') {
                        canonicalDept = a.department;
                    }
                });
            }

            // Update all records in the group if they don't match the canonical version
            for (const auth of group) {
                let changed = false;
                if (auth.authorName !== canonicalName) {
                    auth.authorName = canonicalName;
                    changed = true;
                }
                if (canonicalEmail && !auth.email) {
                    auth.email = canonicalEmail;
                    changed = true;
                }
                if (canonicalDept && auth.department === 'NA') {
                    auth.department = canonicalDept;
                    changed = true;
                }

                if (changed) {
                    await auth.save();
                    updateCount++;
                }
            }
        }

        console.log(`Deduplication complete. Updated ${updateCount} records.`);
        process.exit(0);
    } catch (err) {
        console.error('Deduplication failed:', err);
        process.exit(1);
    }
}

deduplicate();
