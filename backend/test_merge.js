const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const ShardaAuthor = require('./models/ShardaAuthor');

        console.time('agg_out');
        const pipeline = [
            {
                $addFields: {
                    eidStart: { $indexOfBytes: ["$link", "eid="] }
                }
            },
            {
                $addFields: {
                    eidEnd: {
                        $cond: [
                            { $eq: ["$eidStart", -1] },
                            -1,
                            { $indexOfBytes: ["$link", "&", "$eidStart"] }
                        ]
                    }
                }
            },
            {
                $addFields: {
                    extractedEid: {
                        $cond: [
                            { $eq: ["$eidStart", -1] },
                            null,
                            {
                                $cond: [
                                    { $eq: ["$eidEnd", -1] },
                                    { $substrCP: ["$link", { $add: ["$eidStart", 4] }, { $strLenCP: "$link" }] },
                                    { $substrCP: ["$link", { $add: ["$eidStart", 4] }, { $subtract: ["$eidEnd", { $add: ["$eidStart", 4] }] }] }
                                ]
                            }
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $ne: ["$extractedEid", null] },
                            { $concat: ["eid|", "$extractedEid"] },
                            {
                                $cond: [
                                    { $and: [{ $ne: ["$doi", null] }, { $ne: ["$doi", ""] }] },
                                    { $concat: ["doi|", { $toLower: { $trim: { input: "$doi" } } }] },
                                    { $concat: [{ $toLower: { $trim: { input: "$paperTitle" } } }, "|", { $toString: "$year" }] }
                                ]
                            }
                        ]
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
                    countries: { $first: "$countries" },
                    keywords: { $first: "$keywords" },
                    authors: {
                        $push: {
                            authorName: "$authorName",
                            department: "$department",
                            isSharda: "$isSharda",
                            email: "$email"
                        }
                    }
                }
            },
            { $out: "consolidatedpapers" }
        ];

        try {
            await ShardaAuthor.aggregate(pipeline);
            console.log("Materialized view created successfully in 'consolidatedpapers' collection.");
        } catch (e) {
            console.error("Aggregation failed:", e);
        }
        console.timeEnd('agg_out');
        mongoose.disconnect();
    })
    .catch(console.error);
