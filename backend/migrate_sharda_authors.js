const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('./config/db');
const paperController = require('./controllers/paperController');
const ShardaAuthor = require('./models/ShardaAuthor');

async function migrate() {
    try {
        console.log("Connecting to Database...");
        await connectDB();

        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            console.error("Uploads directory not found!");
            process.exit(1);
        }

        const csvFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.csv') && !f.includes('CitationOverview'));
        if (csvFiles.length === 0) {
            console.warn("No CSV files found in uploads directory to re-process.");
            process.exit(0);
        }

        console.log(`Found ${csvFiles.length} CSV files to re-process.`);

        // Step 1: Clear existing ShardaAuthor data
        console.log("Clearing existing ShardaAuthor collection...");
        await ShardaAuthor.deleteMany({});
        console.log("Collection cleared.");

        const apiKey = process.env.SCOPUS_API_KEY;

        // Step 2: Re-process each CSV file
        for (const file of csvFiles) {
            const filePath = path.join(uploadsDir, file);
            console.log(`Processing file: ${file}...`);
            const fileBuffer = fs.readFileSync(filePath);
            
            const result = await paperController.processCSV(fileBuffer, apiKey);
            
            if (result.authors && result.authors.length > 0) {
                console.log(`  - Inserting ${result.authors.length} authors...`);
                await ShardaAuthor.insertMany(result.authors);
            }
        }

        // Step 3: Run post-processing
        console.log("Running post-processing (propagate departments and sync consolidated papers)...");
        await paperController.propagateDepartments();
        await paperController.syncConsolidatedPapers();
        paperController.clearAnalyticsCache();

        console.log("\n==================================");
        console.log("MIGRATION COMPLETE!");
        const finalCount = await ShardaAuthor.distinct('authorName', { isSharda: true });
        console.log(`Final DISTINCT Sharda Author Count: ${finalCount.length}`);
        console.log("==================================\n");
        
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
