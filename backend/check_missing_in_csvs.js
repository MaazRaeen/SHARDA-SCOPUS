const fs = require('fs');

function check() {
  // We'll read the missing titles from the previous discrepancy analysis. 
  // Let's just grab the top 10 from the previous run to test.
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

  files.forEach(file => {
    console.log(`Checking ${file}...`);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      
      let foundCount = 0;
      let foundTitles = [];

      lines.forEach(line => {
         const normLine = line.toLowerCase().replace(/[^a-z0-9]/g, '');
         topMissing.forEach(missingTitle => {
            // Check if the normalized line contains the normalized missing title snippet
            if (normLine.includes(missingTitle) && !foundTitles.includes(missingTitle)) {
               foundTitles.push(missingTitle);
               foundCount++;
            }
         });
      });
      console.log(`  Found ${foundCount} out of ${topMissing.length} sample missing titles.`);
    } catch (err) {
      console.log(`  Error reading file.`);
    }
  });
}

check();
