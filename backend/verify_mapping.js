const { matchNames } = require('./utils/nameMatcher');

// Mock data
const teachers = [
    { name: 'Siddharth Rawat', department: 'Dental Sciences' },
    { name: 'Arvind Kumar Pandey', department: 'Computer Science & Engineering' },
    { name: 'Ajay Kumar', department: 'Computer Science & Engineering' }
];

const testCases = [
    // Exact match
    { author: 'Siddharth Rawat', expected: 'Dental Sciences' },
    // Scopus format with comma
    { author: 'Rawat, S.', expected: 'Dental Sciences' },
    // Scopus format with initials and comma
    { author: 'Pandey, A.K.', expected: 'Computer Science & Engineering' },
    // Scopus format with full name swap
    { author: 'Kumar, Ajay', expected: 'Computer Science & Engineering' },
    // Non-match
    { author: 'Unknown Person', expected: null },
    // Partial Scopus format (no comma) - risky
    { author: 'Rawat S', expected: 'Dental Sciences' }
];

function test() {
    console.log('Starting Name Mapping Verification...\n');
    let passed = 0;

    testCases.forEach((tc, i) => {
        console.log(`Test ${i + 1}: Searching for "${tc.author}"`);

        // Simulate paperController logic
        // 1. Nominal format authorName
        let authorName = tc.author;
        if (tc.author.includes(',')) {
            const parts = tc.author.split(',');
            authorName = `${parts[1].trim()} ${parts[0].trim()}`;
        }

        console.log(`   Normalized to: "${authorName}"`);

        const matchedTeacher = teachers.find(t => matchNames(t.name, authorName));
        const resultDept = matchedTeacher ? matchedTeacher.department : null;

        if (resultDept === tc.expected) {
            console.log(`   ✅ PASSED: Matched to "${resultDept}"`);
            passed++;
        } else {
            console.log(`   ❌ FAILED: Expected "${tc.expected}", got "${resultDept}"`);
        }
        console.log('');
    });

    console.log(`Verification complete. ${passed}/${testCases.length} tests passed.`);
}

test();
