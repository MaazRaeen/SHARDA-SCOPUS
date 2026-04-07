const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const ShardaAuthor = require('./models/ShardaAuthor');

        console.time('agg');
        const matchConditions = {}; // empty to simulate no filters (worst case)

        const pipeline = [
            { $match: matchConditions },
            {
                $group: {
                    _id: {
                        $cond: {
                            if: { $and: [{ $ne: ["$doi", null] }, { $ne: ["$doi", ""] }] },
                            then: { $concat: ["doi|", { $toLower: { $trim: { input: "$doi" } } }] },
                            else: { $concat: [{ $toLower: { $trim: { input: "$paperTitle" } } }, "|", { $toString: "$year" }] }
                        }
                    },
                    paperTitle: { $first: "$paperTitle" },
                    year: { $first: "$year" },
                    sourcePaper: { $first: "$sourcePaper" },
                    publisher: { $first: "$publisher" },
                    doi: { $first: "$doi" },
                    paperType: { $first: "$paperType" },
                    link: { $first: "$link" },
                    quartile: { $first: "$quartile" },
                    citedBy: { $max: "$citedBy" },
                    publicationDate: { $first: "$publicationDate" },
                    authors: {
                        $push: {
                            authorName: "$authorName",
                            department: "$department",
                            isSharda: "$isSharda"
                        }
                    }
                }
            },
        ];

        const result = await ShardaAuthor.aggregate(pipeline).allowDiskUse(true);
        console.timeEnd('agg');

        console.log('Total count:', result.length);

        mongoose.disconnect();
    })
    .catch(console.error);
