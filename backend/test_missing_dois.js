require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');

async function checkMissingDois() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');

  // Find papers where DOI is missing or empty
  const missing = await ShardaAuthor.aggregate([
    { $match: { $or: [{ doi: "" }, { doi: null }, { doi: { $exists: false } }] } },
    { $group: { _id: "$paperTitle", link: { $first: "$link" }, citedBy: { $first: "$citedBy" } } },
    { $sort: { citedBy: -1 } },
    { $limit: 10 }
  ]);

  console.log("Sample papers without DOI:");
  console.log(JSON.stringify(missing, null, 2));

  process.exit(0);
}
checkMissingDois();
