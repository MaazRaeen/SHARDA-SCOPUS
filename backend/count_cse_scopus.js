require("dotenv").config();
const https = require("https");
const mongoose = require("mongoose");
const apiKey = process.env.SCOPUS_API_KEY;

let teachersDb = [];

async function loadTeachers() {
    await mongoose.connect(process.env.MONGODB_URI);
    const teachers = await mongoose.connection.db.collection("teachers").find({
        department: { 
            $in: [
                /computer science/i, 
                /cse/i, 
                /information technology/i, 
                /computer application/i
            ] 
        }
    }).toArray();
    
    // Normalize names for better matching
    teachersDb = teachers.map(t => {
        let name = t.name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
        let parts = name.split(' ');
        return { 
            original: t.name, 
            normalized: name,
            first: parts[0],
            last: parts[parts.length - 1]
        };
    });
    console.log(`Loaded ${teachersDb.length} CSE/IT/BCA teachers for cross-referencing.`);
}

function fetchPage(start) {
    return new Promise((resolve, reject) => {
        // Just textually use the 9317 query string
        const queryText = "AFFIL(\"Sharda University\") OR AFFIL(\"Sharda Univ\") OR AFFIL(\"Sharda Hospital\")";
        const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(queryText)}&start=${start}&count=100&field=author`;
        
        https.get(url, {
            headers: { "X-ELS-APIKey": apiKey, "Accept": "application/json" }
        }, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch(e) {
                    reject(e);
                }
            });
        }).on("error", reject);
    });
}

async function run() {
    await loadTeachers();
    
    const firstPage = await fetchPage(0);
    const totalResultsStr = firstPage["search-results"]?.["opensearch:totalResults"] || "0";
    const totalResults = parseInt(totalResultsStr, 10);
    console.log(`Total Scopus Universe to estimate from: ${totalResults}`);

    if (totalResults === 0) {
        process.exit(0);
    }

    let csePapersCount = 0;
    let validPapersProcessed = 0;
    
    // Sample the first 1000 papers for speed
    const limit = Math.min(1000, totalResults); 

    for(let i = 0; i < limit; i += 100) {
        process.stdout.write(`Scanning papers ${i} to ${i+100}...\n`);
        const page = await fetchPage(i);
        const entries = page["search-results"]?.entry || [];
        
        for (const entry of entries) {
            validPapersProcessed++;
            let isCsePaper = false;
            
            const authors = entry.author || [];
            if (!authors.length) continue;
            
            for (const author of authors) {
                let givenName = (author["given-name"] || "").toLowerCase().trim();
                let surname = (author["surname"] || "").toLowerCase().trim();
                
                // Fast check against CSE teachers
                for(const t of teachersDb) {
                    if (givenName === t.first && surname === t.last) {
                        isCsePaper = true;
                        break;
                    }
                    if (givenName && surname && t.normalized === `${givenName} ${surname}`) {
                        isCsePaper = true;
                        break;
                    }
                }
                if (isCsePaper) break;
            }
            if (isCsePaper) csePapersCount++;
        }
    }
    
    console.log(`\n\n--- EXACT ESTIMATION RESULTS ---`);
    console.log(`Sample Size Analyzed: ${validPapersProcessed} papers`);
    console.log(`CSE Papers found in sample: ${csePapersCount}`);
    
    const percentage = (csePapersCount / validPapersProcessed);
    console.log(`CSE representation rate: ${(percentage * 100).toFixed(1)}%`);
    
    const estimatedTotalCse = Math.round(totalResults * percentage);
    console.log(`\n>>> Estimated TOTAL CSE Papers on Scopus: ~${estimatedTotalCse} <<<`);
    console.log(`(This means out of the ${totalResults} total Sharda papers, about ${estimatedTotalCse} belong to the Computer Science & Engineering department based on author mapping)`);
    
    await mongoose.disconnect();
    process.exit(0);
}

run();
