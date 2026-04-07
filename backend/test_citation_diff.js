require('dotenv').config();
const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const fs = require('fs');

async function checkMissingCitations() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda_research');

  const totalCitations = await ShardaAuthor.aggregate([
    {
      $group: {
        _id: "$paperTitle",
        citedBy: { $first: "$citedBy" },
        doi: { $first: "$doi" },
        eid: { $first: "$link" } // link often contains scopus EID
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$citedBy" },
        papersWithCitations: { $sum: { $cond: [{ $gt: ["$citedBy", 0] }, 1, 0] } },
        papersWithoutDoi: { $sum: { $cond: [{ $eq: ["$doi", ""] }, 1, 0] } },
        papersWithoutDoiWithCitations: { $sum: { $cond: [{ $and: [{ $eq: ["$doi", ""] }, { $gt: ["$citedBy", 0] }] }, 1, 0] } },
        totalPapers: { $sum: 1 }
      }
    }
  ]);

  console.log("DB Aggregation Results:");
  console.log(JSON.stringify(totalCitations[0], null, 2));

  // also check if any papers have DOI empty but have an EID/Link we could use
  const nullDois = await ShardaAuthor.countDocuments({ $or: [{ doi: "" }, { doi: null }] });
  console.log("Total DB rows missing DOI:", nullDois);

  process.exit(0);
}
checkMissingCitations();
