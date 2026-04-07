const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
require('dotenv').config();

async function checkDateStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB...");

    const totalWithDoi = await ShardaAuthor.countDocuments({ doi: { $ne: null, $ne: '' } });
    console.log(`Total records with DOI: ${totalWithDoi}`);

    const missingDate = await ShardaAuthor.countDocuments({
      doi: { $ne: null, $ne: '' },
      $or: [
        { publicationDate: { $exists: false } },
        { publicationDate: null }
      ]
    });
    console.log(`Records missing publicationDate: ${missingDate}`);

    // Check for Jan 1st fallback dates
    const Jan1Count = await ShardaAuthor.countDocuments({
        doi: { $ne: null, $ne: '' },
        publicationDate: { $regex: /-01-01$/ }
    });
    console.log(`Records with Jan 1st fallback dates: ${Jan1Count}`);

    const uniqueDois = await ShardaAuthor.distinct('doi', { doi: { $ne: null, $ne: '' } });
    console.log(`Unique DOIs to process: ${uniqueDois.length}`);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

checkDateStatus();
