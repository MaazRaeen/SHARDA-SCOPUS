const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const ShardaAuthor = require('../models/ShardaAuthor');
const Teacher = require('../models/Teacher');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// Cache for Gemini File URIs
let geminiFileCache = {
    research: { fileUri: null, mimeType: null, dbVersion: null, expiry: 0 },
    faculty: { fileUri: null, mimeType: null, fileHash: null, expiry: 0 }
};

/**
 * Automatically syncs current DB state to Gemini as a CSV file
 */
async function syncDatabaseToGemini() {
    try {
        const totalCount = await ShardaAuthor.countDocuments();
        const lastRecord = await ShardaAuthor.findOne().sort({ updatedAt: -1 }).select('updatedAt');
        const lastUpdated = lastRecord ? lastRecord.updatedAt.getTime() : 0;
        const currentVersion = `${totalCount}_${lastUpdated}`;

        // Return cached URI if valid
        if (geminiFileCache.research.fileUri && geminiFileCache.research.dbVersion === currentVersion && Date.now() < geminiFileCache.research.expiry) {
            return geminiFileCache.research;
        }

        console.log('Syncing research data to Gemini...');

        // Fetch all records - limited fields for efficiency (staying under token limit)
        const records = await ShardaAuthor.find({}).select('authorName department paperTitle year paperType citedBy').lean();

        if (records.length === 0) return null;

        // Generate CSV - Essential Fields Only
        const headers = ['Author Name', 'Department', 'Paper Title', 'Year', 'Type', 'Citations'];
        const csvRows = [headers.join(',')];

        for (const r of records) {
            const row = [
                `"${(r.authorName || '').replace(/"/g, '""')}"`,
                `"${(r.department || '').replace(/"/g, '""')}"`,
                `"${(r.paperTitle || '').replace(/"/g, '""')}"`,
                r.year || '',
                `"${(r.paperType || '').replace(/"/g, '""')}"`,
                r.citedBy || 0
            ];
            csvRows.push(row.join(','));
        }

        const csvContent = csvRows.join('\n');
        const tempPath = path.join(__dirname, '../uploads/current_research_data.csv');

        if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
            fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
        }

        fs.writeFileSync(tempPath, csvContent);

        // Upload to Gemini
        const uploadResult = await fileManager.uploadFile(tempPath, {
            mimeType: "text/csv",
            displayName: "Current Research Data",
        });

        // Cleanup
        fs.unlinkSync(tempPath);

        geminiFileCache.research = {
            fileUri: uploadResult.file.uri,
            mimeType: uploadResult.file.mimeType,
            dbVersion: currentVersion,
            expiry: Date.now() + (24 * 60 * 60 * 1000)
        };

        return geminiFileCache.research;
    } catch (err) {
        console.error('Gemini Research Sync Error:', err);
        return null;
    }
}

/**
 * Automatically converts and syncs faculty list to Gemini
 */
async function syncFacultyToGemini() {
    try {
        const facultyPath = path.join(__dirname, '../uploads/Combined Faculty list.xlsx');
        if (!fs.existsSync(facultyPath)) return null;

        const stats = fs.statSync(facultyPath);
        const fileHash = `${stats.size}_${stats.mtimeMs}`;

        if (geminiFileCache.faculty.fileUri && geminiFileCache.faculty.fileHash === fileHash && Date.now() < geminiFileCache.faculty.expiry) {
            return geminiFileCache.faculty;
        }

        console.log('Syncing faculty data to Gemini...');
        const workbook = xlsx.readFile(facultyPath);
        const sheetName = workbook.SheetNames.includes('Sheet1') ? 'Sheet1' : workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        if (data.length === 0) return null;

        const headers = ['Name', 'EmpId', 'Department', 'School'];
        const csvRows = [headers.join(',')];

        data.forEach(row => {
            const csvRow = [
                `"${(row['Name'] || '').toString().replace(/"/g, '""')}"`,
                `"${(row['Emp Id'] || '').toString().replace(/"/g, '""')}"`,
                `"${(row['Dept.'] || '').toString().replace(/"/g, '""')}"`,
                `"${(row['School'] || '').toString().replace(/"/g, '""')}"`
            ];
            csvRows.push(csvRow.join(','));
        });

        const tempCsvPath = path.join(__dirname, '../uploads/current_faculty_data.csv');
        fs.writeFileSync(tempCsvPath, csvRows.join('\n'));

        const uploadResult = await fileManager.uploadFile(tempCsvPath, {
            mimeType: "text/csv",
            displayName: "Faculty List",
        });

        fs.unlinkSync(tempCsvPath);

        geminiFileCache.faculty = {
            fileUri: uploadResult.file.uri,
            mimeType: uploadResult.file.mimeType,
            fileHash: fileHash,
            expiry: Date.now() + (24 * 60 * 60 * 1000)
        };

        return geminiFileCache.faculty;
    } catch (err) {
        console.error('Gemini Faculty Sync Error:', err);
        return null;
    }
}

exports.getChatResponse = async (req, res) => {
    try {
        const userQuery = req.body.query;

        if (!userQuery) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // 1. Sync Data to Gemini
        const researchContext = await syncDatabaseToGemini();
        const facultyContext = await syncFacultyToGemini();

        // Grounding Stats (to ensure AI accuracy on counts)
        // Calculating unique authors based on Name + Department pairs as per user definition
        const researchAuthorStats = await ShardaAuthor.aggregate([
            {
                $group: {
                    _id: {
                        name: { $toUpper: { $trim: { input: '$authorName' } } },
                        dept: '$department'
                    }
                }
            }
        ]);
        const uniqueResearchAuthors = researchAuthorStats.length;
        const totalFacultyRecords = await Teacher.countDocuments();

        // 2. Construct System Context
        const systemPrompt = `
You are the Research Intelligence Assistant for Sharda University.

**Ground Truth Data (DO NOT CONTRADICT):**
- Total Unique Sharda Research Authors (from Research CSV): ${uniqueResearchAuthors}.
- Total Official Faculty Records (from Faculty List): ${totalFacultyRecords}.

**CRITICAL INSTRUCTIONS:**
1. **Authorship Count**: ALWAYS use the count of **${uniqueResearchAuthors}** when asked for the total number of Sharda authors. This count is derived strictly from the **Research Data CSV** (the main CSV).
2. **Prioritize Main CSV**: The Research Data CSV is the SOLE source of truth for all statistics, paper counts, and citation data. 
3. **Faculty List Usage**: Use the Faculty List CSV **ONLY** as a fallback to find an author's department if it is "NA" or missing in the Research Data. 
4. **No Merging**: Do NOT combine unique names from both files for the "Total Author" count. Use the Research Data count ONLY.
5. **Mapping**: Map all resolved departments to the **Canonical 25 Departments** list below.
6. **Constraint**: BE EXTREMELY CRISP AND DIRECT. No fluff.

**Canonical Departments:**
Dental Science, Medical Sciences, Education, Pharmacy, Allied Health Science, Agricultural Science, Business and Commerce, Management, Chemistry and Biochemistry, Environmental Science, Life Sciences, Mathematics, Physics, Architecture, Art and Science, Biotechnology, Civil Engineering, Computer Science & Applications, Computer Science & Engineering, Electrical Electronics & Communication Engineering, Mechanical Engineering, Humanities & Social Sciences, Mass Communication, Nursing Sciences, Law.
`;

        // 3. Call Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const contents = [];
        if (researchContext) {
            contents.push({ fileData: { mimeType: researchContext.mimeType, fileUri: researchContext.fileUri } });
        }
        if (facultyContext) {
            contents.push({ fileData: { mimeType: facultyContext.mimeType, fileUri: facultyContext.fileUri } });
        }

        contents.push({ text: `${systemPrompt}\n\nUser Question: ${userQuery}` });

        const result = await model.generateContent(contents);
        const responseText = result.response.text();

        res.json({ answer: responseText });

    } catch (error) {
        console.error('Gemini Chat Error:', error);
        res.status(500).json({ error: 'Failed to generate response', details: error.message });
    }
};
