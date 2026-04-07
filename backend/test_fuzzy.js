const { matchNames } = require('./utils/nameMatcher');

const cases = [
    { n1: "Ambuj Kumar Agarwal", n2: "Ambuj Agarwal", expected: true },
    { n1: "Ambuj Kumar Agarwal", n2: "Ambuj Aggarwal", expected: true },
    { n1: "Ambuj Kumar Agarwal", n2: "Ambuj Agrawal", expected: true },
    { n1: "Arvind Pandey", n2: "Arvind Kumar Pandey", expected: true }
];

console.log('Fuzzy/Middle Name Testing:\n');
cases.forEach((tc, i) => {
    const result = matchNames(tc.n1, tc.n2);
    console.log(`Test ${i + 1}: "${tc.n1}" vs "${tc.n2}" -> Result: ${result} (Expected: ${tc.expected})`);
});
