
const mongoose = require('mongoose');
const env = require('dotenv').config();

const ShardaAuthor = mongoose.model('ShardaAuthor', new mongoose.Schema({
    doi: String,
    publicationDate: String
}));

async function checkDist() {
    await mongoose.connect(process.env.MONGODB_URI);
    const papers = await ShardaAuthor.find({ doi: { $ne: null, $ne: "" } }).select('publicationDate').lean();
    const stats = { total: papers.length, missing: 0, yearOnly: 0, precise: 0 };
    papers.forEach(p => {
        if (!p.publicationDate) stats.missing++;
        else if (p.publicationDate.length === 4) stats.yearOnly++;
        else stats.precise++;
    });
    console.log(JSON.stringify(stats, null, 2));
    await mongoose.connection.close();
}

checkDist().catch(console.error);
