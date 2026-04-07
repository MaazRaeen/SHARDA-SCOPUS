require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const fs = require('fs');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const year = 2026;
        const deptFilter = "Computer Science and Engineering";

        // Let's simulate the previous getAnalytics logic if we can read old_controller.js
        const oldLogicDBQuery = {};
        if (year) oldLogicDBQuery.year = year;
        if (deptFilter && deptFilter !== 'All Departments') {
            oldLogicDBQuery.department = { $regex: new RegExp(deptFilter, 'i') };
        }

        const rawRecords = await ShardaAuthor.find(oldLogicDBQuery).lean();

        // Let's see how old logic grouped them
        // In my previous conversation I saw that sometimes they used sourcePaper or publisher interchangeably
        const uniqueKeys = new Set();
        rawRecords.forEach(r => {
            // How did they previously group papers? 
            // In a previous conversation, we changed the unique paper identifier to include doi/link. 
            // Previously it was just paperTitle. Let's see:
            uniqueKeys.add(r.paperTitle);
        });

        console.log(`Raw DB records for old query: ${rawRecords.length}`);
        console.log(`Unique papers by JUST paperTitle: ${uniqueKeys.size}`);

        const oldUnique = new Set();
        rawRecords.forEach(r => {
            oldUnique.add([r.paperTitle, r.year, r.sourcePaper, r.publisher].join('|'));
        });

        console.log(`Unique papers by paperTitle+year+sourcePaper+publisher: ${oldUnique.size}`);

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
run();
