const mongoose = require('mongoose');
const ShardaAuthor = require('./models/ShardaAuthor');
const dotenv = require('dotenv');

dotenv.config();

async function runDiagnostics() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sharda');
        console.log("Connected to MongoDB...");

        const totalRecords = await ShardaAuthor.countDocuments();
        console.log(`\nTotal ShardaAuthor records: ${totalRecords}`);

        // Group by paper identity to count unique papers (same logic as getAnalytics)
        const pipeline = [
            {
                $group: {
                    _id: {
                        paperTitle: "$paperTitle",
                        year: "$year",
                        source: "$sourcePaper",
                        publisher: "$publisher",
                        doi: "$doi",
                        type: "$paperType",
                        link: "$link",
                        quartile: "$quartile"
                    }
                }
            },
            { $count: "uniquePapers" }
        ];

        const aggregationResult = await ShardaAuthor.aggregate(pipeline);
        const uniquePapers = aggregationResult.length > 0 ? aggregationResult[0].uniquePapers : 0;
        console.log(`Unique papers (via Analytics grouping): ${uniquePapers}`);

        // Let's check for any duplicates that have different secondary fields but same Title/Year/DOI
        const basicPipeline = [
            {
                $group: {
                    _id: {
                        paperTitle: "$paperTitle",
                        year: "$year",
                        doi: "$doi"
                    }
                }
            },
            { $count: "basicUnique" }
        ];
        const basicResult = await ShardaAuthor.aggregate(basicPipeline);
        const basicUnique = basicResult.length > 0 ? basicResult[0].basicUnique : 0;
        console.log(`Unique papers (by Title/Year/DOI only): ${basicUnique}`);

        if (uniquePapers > basicUnique) {
            console.log(`\nDetected ${uniquePapers - basicUnique} papers that are technically the same (Title/Year/DOI) but have different secondary metadata (source/publisher/type/link/quartile).`);
        }

        console.log("\nPossible reasons for 9237 vs 9255:");
        console.log("1. 18 papers in the CSV did NOT contain 'Sharda' in any author affiliation.");
        console.log("2. 18 papers were duplicates in the CSV and got merged during import or in the dashboard grouping.");
        console.log("3. 18 papers were missing titles in the CSV and were skipped.");

        process.exit(0);
    } catch (err) {
        console.error("Error during diagnostics:", err);
        process.exit(1);
    }
}

runDiagnostics();
