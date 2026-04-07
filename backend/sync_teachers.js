const mongoose = require('mongoose');
require('dotenv').config();
const Teacher = require('./models/Teacher');
const ShardaAuthor = require('./models/ShardaAuthor');

async function syncBackToTeacher() {
    try {
        console.log("Connecting to Database...");
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB Connected.");

        // Find all teachers
        const teachers = await Teacher.find({});
        console.log(`Analyzing ${teachers.length} teachers for enrichment...`);

        let updateCount = 0;
        for (const t of teachers) {
            // Find a high-confidence match in ShardaAuthor via Email or exact name
            const match = await ShardaAuthor.findOne({
                $or: [
                    { email: t.email },
                    { authorName: t.name }
                ],
                scopusId: { $exists: true, $ne: null }
            }).lean();

            if (match) {
                let changed = false;
                if (!t.scopusId) {
                    t.scopusId = match.scopusId;
                    changed = true;
                }
                
                // Collect alternate names (abbreviations) from ShardaAuthor
                const variants = await ShardaAuthor.distinct('authorName', { scopusId: match.scopusId });
                for (const v of variants) {
                    if (v !== t.name && !t.alternateNames.includes(v)) {
                        t.alternateNames.push(v);
                        changed = true;
                    }
                }

                if (changed) {
                    await t.save();
                    updateCount++;
                    if (updateCount % 10 === 0) console.log(`Enriched ${updateCount} teachers...`);
                }
            }
        }

        console.log(`\nCOMPLETED: Enriched ${updateCount} teachers with Scopus IDs and alternate names.`);
        process.exit(0);
    } catch (err) {
        console.error("Sync failed:", err);
        process.exit(1);
    }
}

syncBackToTeacher();
