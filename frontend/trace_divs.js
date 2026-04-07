const fs = require('fs');
const html = fs.readFileSync('src/app/components/dashboard/dashboard.component.html', 'utf8');
const lines = html.split('\n');

let balance = 0;
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Using a better regex to separate opening vs closing vs self-closing
    // This is a naive regex but works fairly well for this file formatting
    const opens = (line.match(/<div(?:\s[^>]*)?>/gi) || []).length;
    const closes = (line.match(/<\/div>/gi) || []).length;
    
    balance += (opens - closes);
    
    // Print lines between 420 and 480 to see the exact structure
    if (i >= 420 && i <= 480) {
        console.log(`${(i+1).toString().padStart(4)}: [BAL ${balance.toString().padStart(2)}] ${line}`);
    }
}
