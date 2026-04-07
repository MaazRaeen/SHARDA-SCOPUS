
const mongoose = require('mongoose');
const env = require('dotenv').config();

const ShardaAuthor = mongoose.model('ShardaAuthor', new mongoose.Schema({
    doi: String,
    publicationDate: String,
    paperTitle: String
}));

async function sample() {
    await mongoose.connect(process.env.MONGODB_URI);
    const samples = await ShardaAuthor.find({ doi: { $ne: null, $ne: "" } }).limit(10).lean();
    console.log(JSON.stringify(samples, null, 2));
    await mongoose.connection.close();
}

sample().catch(console.error);
