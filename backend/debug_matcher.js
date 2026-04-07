const { matchNames, normalize } = require('./utils/nameMatcher');

const n1 = "Ambuj Kumar Agarwal";
const n2 = "Ambuj Agrawal";

console.log('Testing:', n1, 'vs', n2);
const res = matchNames(n1, n2);
console.log('Final Result:', res);
