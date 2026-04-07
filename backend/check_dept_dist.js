const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const stats = await ShardaAuthor.aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]);

    console.log('--- Department Distribution ---');
    stats.forEach(s => {
        console.log(`${s._id || 'NULL'}: ${s.count}`);
    });
    console.log(`Unique departments (excluding NA/NULL): ${stats.filter(s => s._id && s._id !== 'NA').length}`);
    process.exit(0);
}
run().catch(console.error);
