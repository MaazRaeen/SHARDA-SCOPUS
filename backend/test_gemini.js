require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const API_KEY = process.env.GEMINI_API_KEY;

async function testGemini() {
    try {
        if (!API_KEY) {
            throw new Error("GEMINI_API_KEY is missing in .env file");
        }
        console.log("Using API Key:", API_KEY.substring(0, 10) + "...");

        const genAI = new GoogleGenerativeAI(API_KEY);
        const modelName = "gemini-3-flash-preview";
        console.log(`Testing model: ${modelName}...`);

        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello, are you working?");
        const response = await result.response;
        const text = response.text();

        console.log("Response received:");
        console.log(text);
        console.log("✅ Gemini API Test Passed!");
    } catch (err) {
        console.error("❌ Gemini API Test Failed:", err);
    }
}

testGemini();
