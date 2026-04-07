require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        // Exact params from getAnalytics
        const startDate = "2026-01-01";
        const endDate = "2026-12-31";
        const deptFilter = "Computer Science and Engineering";// Wait,  ?

        const dateQuery = {};
        if (startDate) dateQuery.$gte = new Date(startDate);
        if (endDate) dateQuery.$lte = new Date(endDate);

        const startYear = new Date(startDate).getFullYear();
        const endYear = new Date(endDate).getFullYear();

        const dbQuery = {};

        dbQuery.department = { $regex: new RegExp('computer science', 'i') }; // simplified for test

        dbQuery.$or = [
            { publicationDate: dateQuery },
            {
                publicationDate: { $in: [null, undefined] },
                year: { $gte: startYear, $lte: endYear }
            }
        ];

        console.log("DB Query:", JSON.stringify(dbQuery, null, 2));

        const rawRecords = await ShardaAuthor.find(dbQuery).lean();

        console.log(`Raw DB Author Records matching getAnalytics query: ${rawRecords.length}`);

        // Group them perfectly exactly like getAnalytics does
        const uniquePapers = new Set(rawRecords.map(r => {
            return [
                r.paperTitle,
                r.year,
                r.sourcePaper,
                r.publisher,
                r.doi,
                r.link,
                r.paperType
            ].join('|');
        }));

        console.log(`Grouped Unique Papers (Dashboard Logic): ${uniquePapers.size}`);

        // Find the missing papers (those that are year 2026 but failing the date query)
        const all2026CS = await ShardaAuthor.find({
            year: 2026,
            department: { $regex: /computer science/i }
        }).lean();

        const allUnique2026CS = new Set(all2026CS.map(r => [r.paperTitle, r.year, r.sourcePaper, r.publisher, r.doi, r.link, r.paperType].join('|')));
        console.log(`Total Grouped CS Papers for Year=2026 regardless of date filtering: ${allUnique2026CS.size}`);

        let missing = 0;
        for (const p of all2026CS) {
            const isMatched = rawRecords.some(r => r._id.toString() === p._id.toString());
            if (!isMatched) {
                if (missing < 5) {
                    console.log(`MISSING from query -> DOI: ${p.doi}, exact publicationDate: ${p.publicationDate}, year: ${p.year}`);
                }
                missing++;
            }
        }
        console.log(`Total records missing from the date filter: ${missing}`);

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
run();
