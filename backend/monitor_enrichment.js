const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
require('dotenv').config();

async function monitorProgress() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const totalWithDoi = await ShardaAuthor.distinct('doi', { doi: { $ne: null, $ne: '' } });
    
    // Count records with high-precision dates (not Jan 1st)
    const preciseCount = await ShardaAuthor.countDocuments({
      doi: { $ne: null, $ne: '' },
      $expr: {
        $and: [
          { $ne: [{ $type: "$publicationDate" }, "missing"] },
          { $ne: ["$publicationDate", null] },
          {
            $or: [
              { $ne: [{ $month: "$publicationDate" }, 1] },
              { $ne: [{ $dayOfMonth: "$publicationDate" }, 1] }
            ]
          }
        ]
      }
    });

    console.log(`Unique DOIs: ${totalWithDoi.length}`);
    console.log(`Records with high-precision dates: ${preciseCount}`);
    
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

monitorProgress();
