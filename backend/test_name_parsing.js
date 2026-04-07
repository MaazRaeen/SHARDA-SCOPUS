const { formatAuthorName } = require('./utils/nameMatcher');

const testCases = [
    "Khan, Azmat Ali, Department of Dental Science, Sharda University, Greater Noida, India",
    "Choudhury, Biplab Loho, Department of Medical Sciences, Sharda University",
    "Lokireddy, Chakridhar Reddy, Sharda University",
    "Smith, John, Dept of CS, Sharda University"
];

function testParsing(entry) {
    console.log(`\nEntry: "${entry}"`);

    // Logic from sync_papers.js (lines 29-32)
    const parts = entry.split(',').map(p => p.trim()).filter(p => p);

    // This is the suspected problematic line:
    const authorNameRaw = parts[0];
    console.log(`Current Logic (parts[0]): "${authorNameRaw}"`);
    console.log(`Formatted Current: "${formatAuthorName(authorNameRaw)}"`);

    // Proposed Fix: Take parts[0] + parts[1]
    if (parts.length >= 2) {
        const fullNameRaw = `${parts[0]}, ${parts[1]}`;
        console.log(`Proposed Logic (parts[0], parts[1]): "${fullNameRaw}"`);
        console.log(`Formatted Proposed: "${formatAuthorName(fullNameRaw)}"`);
    }
}

testCases.forEach(testParsing);
