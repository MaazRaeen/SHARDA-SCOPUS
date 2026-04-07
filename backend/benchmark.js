const { matchNamesStrict } = require('./utils/nameMatcher');

console.time('match');
let matches = 0;
for (let i = 0; i < 50000; i++) {
   // simulating matching 50 candidates for 1000 authors
   for(let j=0; j<50; j++) {
       if (matchNamesStrict("Arvind Kumar Pandey", "A. K. Pandey")) matches++;
       if (matchNamesStrict("Arghadeep Debnath", "A. Debnath")) matches++;
       if (matchNamesStrict("Sudeep Varshney", "S. Varshney")) matches++;
   }
}
console.timeEnd('match');
console.log(matches);
