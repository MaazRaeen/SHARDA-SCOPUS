const fs = require('fs');

function check() {
  const topMissing = [
    "Global burden and strength of evidence for 88 risk",
    "Global Burden of Cardiovascular Diseases and Risks",
    "Assessing knowledge attitudes and practices of de",
    "Global regional and national age-sex-specific bu",
    "Global regional and national burden of HIV/AIDS",
    "Burden of 375 diseases and injuries risk-attribut",
    "Global regional and national burden of upper res"
  ].map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const files = ['uploads/1769762388605-953484648.csv', 'uploads/1771400310932-135936941.csv'];

  // Let's print out if we find just a part of the title
  files.forEach(file => {
    console.log(`\nChecking ${file}...`);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      
      topMissing.forEach(missingTitle => {
         // let's just search for the first 25 characters
         const searchKey = missingTitle.substring(0, 30);
         let found = false;
         for (let line of lines) {
             const normLine = line.toLowerCase().replace(/[^a-z0-9]/g, '');
             if (normLine.includes(searchKey)) {
                 console.log(`  [MATCH] Found partial match for "${missingTitle.substring(0, 20)}...":`);
                 // print just a snippet of the line so we don't spam
                 console.log(`          -> ${line.substring(0, 100)}`);
                 found = true;
                 break;
             }
         }
         if (!found) {
             console.log(`  [MISSING] Could not find any trace of "${missingTitle.substring(0, 20)}..."`);
         }
      });

    } catch (err) {
      console.log(`  Error reading file: ${err.message}`);
    }
  });
}

check();
