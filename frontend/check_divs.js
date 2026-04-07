const fs = require('fs');
const html = fs.readFileSync('src/app/components/dashboard/dashboard.component.html', 'utf8');

const lines = html.split('\n');
let divBalance = 0;
let lastErrorLine = -1;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const openMatches = line.match(/<div(\s|>)/gi);
    const closeMatches = line.match(/<\/div>/gi);
    
    if (openMatches) divBalance += openMatches.length;
    if (closeMatches) divBalance -= closeMatches.length;
    
    if (divBalance < 0) {
        console.log('Negative balance at line:', i + 1);
        lastErrorLine = i + 1;
        break;
    }
}
console.log('Final div balance:', divBalance);
