const fs = require('fs');

const content = fs.readFileSync('uploads/1771400310932-135936941.csv', 'utf-8');
const lines = content.split('\n');
console.log("Headers:", lines[0]);

const targetKeywords = [
  "global burden and strength of evidence",
  "global burden of cardiovascular diseases",
  "assessing knowledge attitudes"
];

let matchCount = 0;
for (let i = 1; i < lines.length; i++) {
   const lowerLine = lines[i].toLowerCase();
   for (let kw of targetKeywords) {
       if (lowerLine.includes(kw)) {
           console.log(`\nMatch for [${kw}] at line ${i}:`);
           // split carefully
           const regex = /(".*?"|[^",\s]+)(?=\s*,|\s*$)/g;
           const parts = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
           console.log(`Title field (index 3): ${parts[3]}`);
           console.log(`Citations (index 11): ${parts[11]}`);
           console.log(`Affiliations (index 14): ${parts[14]}`);
           matchCount++;
       }
   }
}
console.log("Total exact keyword matches:", matchCount);
