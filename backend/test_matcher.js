const { matchNames, normalize, getSnameParts, parseScopusSname } = require('./utils/nameMatcher');

const testCases = [
    { n1: "Shajee Mohan", n2: "Shajee Mohan B S", expected: true },
    { n1: "Arvind Kumar Pandey", n2: "Pandey, A.K.", expected: true },
    { n1: "Singh, Mahinder Chauhan", n2: "Singh, M.C.", expected: true },
    { n1: "Mahinder Singh Chauhan", n2: "Chauhan, M.S.", expected: true },
    { n1: "Kumar, S.", n2: "Kumar, A.", expected: false },
    { n1: "Singh, M.", n2: "Singh, Mahinder", expected: true },
    { n1: "Kavita Goyal", n2: "Goyal, K.", expected: true },
    { n1: "Baby Ilma", n2: "Ilma, B.", expected: true }
];

function runTests() {
    console.log('Running Name Matcher Tests...\n');
    let passed = 0;
    testCases.forEach((tc, i) => {
        const result = matchNames(tc.n1, tc.n2);
        const status = result === tc.expected ? 'PASSED' : 'FAILED';
        if (result === tc.expected) passed++;
        console.log(`Test ${i + 1}: "${tc.n1}" vs "${tc.n2}"`);
        console.log(`Expected: ${tc.expected}, Got: ${result} -> ${status}\n`);
    });
    console.log(`Summary: ${passed}/${testCases.length} passed.`);
}

runTests();
