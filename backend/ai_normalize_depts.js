const { GoogleGenerativeAI } = require("@google/generative-ai");
const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

// Load models
const ShardaAuthor = require('./models/ShardaAuthor');
const Teacher = require('./models/Teacher');

const API_KEY = "AIzaSyAqIiTsSsfIMsg9mIi_6Ui2y9TGd0hZuz8"; // Provided by user
const MODEL_NAME = "gemini-3-flash-preview";

const canonicalDepartments = [
    "department of dental science",
    "department of Medical Sciences",
    "department of education",
    "department of pharmacy",
    "department of allied health science",
    "department of agricultural science",
    "department of business and commerse",
    "department of management",
    "department of chemistry and biochemistry",
    "department of environmental science",
    "department of life sciences",
    "department of mathematics",
    "department of physics",
    "department of Architecture",
    "department of art and science",
    "department of Biotechnology",
    "department of Civil Engineering",
    "department of Computer Science & Applications",
    "department of Computer Science & Engineering",
    "department of Electrical Electronics & Communication Engineering",
    "department of Mechanical Engineering",
    "department of Humanities & Social Sciences",
    "department of Mass Communication",
    "department of Nursing Sciences",
    "department of Law"
];

async function generateMapping() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Fetching unique departments from DB...');

        // Get all unique departments from both collections
        const authorDepts = await ShardaAuthor.distinct('department');
        const teacherDepts = await Teacher.distinct('department');
        const allMessyDepts = [...new Set([...authorDepts, ...teacherDepts])].filter(d => d && d !== 'NA' && d !== 'Unspecified');

        console.log(`Found ${allMessyDepts.length} unique messy department strings.`);

        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });

        const prompt = `
    You are an expert at normalizing academic department names.
    I have a list of messy department strings from a research database (Scopus).
    I need to map each of these strings to one of exactly 25 canonical department names.

    CANONICAL DEPARTMENTS:
    ${canonicalDepartments.join('\n')}

    MESSY STRINGS:
    ${allMessyDepts.join('\n')}

    INSTRUCTIONS:
    1. Map each messy string to the MOST LIKELY canonical department.
    2. If a messy string contains multiple departments (e.g. "Dept of CSE, Dept of ECE"), pick the most prominent one or the first one.
    3. Return ONLY a valid JSON object where the key is the messy string and the value is the canonical department name.
    4. Do not include any explanation or markdown formatting in your response. Just the raw JSON.
    `;

        console.log('Calling Gemini API for mapping...');
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Cleanup markdown if AI included it
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const mapping = JSON.parse(text);

        fs.writeFileSync('./dept_map.json', JSON.stringify(mapping, null, 2));
        console.log('Successfully saved mapping to dept_map.json');
        process.exit(0);
    } catch (err) {
        console.error('Error generating mapping:', err);
        process.exit(1);
    }
}

generateMapping();
