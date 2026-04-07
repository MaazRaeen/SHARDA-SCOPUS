require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const yearFilter = 2026;

        let dept = "Computer Science and Engineering";
        let regex = new RegExp(dept, 'i');

        // Let's count all records matching this department and year
        const count1 = await ShardaAuthor.countDocuments({ year: yearFilter, department: regex });
        console.log("Count with exact CSE regex (raw):", count1);

        // Let's count all records with JUST "computer science" regex
        const count2 = await ShardaAuthor.countDocuments({ year: yearFilter, department: /computer science/i });
        console.log("Count with /computer science/i (raw):", count2);

        // Let's get unique papers without date restriction, just year
        const rawPapers2 = await ShardaAuthor.find({ year: yearFilter, department: /computer science/i }).lean();
        const unique2 = new Set(rawPapers2.map(r => [r.paperTitle, r.year, r.sourcePaper, r.publisher, r.doi, r.link, r.paperType].join('|')));
        console.log("Unique with /computer science/i:", unique2.size);

        // What if they selected a different department? Let's check all departments max.
        const allDepts = await ShardaAuthor.aggregate([
            { $match: { year: 2026 } },
            { $group: { _id: "$department", count: { $sum: 1 } } }
        ]);
        console.log("Department counts for 2026:");
        allDepts.forEach(d => console.log(d._id, ':', d.count));

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
run();
