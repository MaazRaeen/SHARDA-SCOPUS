const mongoose = require('mongoose');
require('dotenv').config();
const ShardaAuthor = require('./models/ShardaAuthor');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const paper = await ShardaAuthor.findOne({ paperTitle: /Secured VANET Using Privacy/i }).lean();
        console.log("Paper:", paper ? { title: paper.paperTitle, doi: paper.doi, year: paper.year, publicationDate: paper.publicationDate } : "Not found");
    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
run();
