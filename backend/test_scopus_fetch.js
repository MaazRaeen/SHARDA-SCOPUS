const https = require("https");
const apiKey = process.env.SCOPUS_API_KEY;

function fetchPage(start) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.elsevier.com/content/search/scopus?query=affil(Sharda%20University)&start=${start}&count=100&field=dc:title,author,affiliation`, {
      headers: { "X-ELS-APIKey": apiKey, "Accept": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function run() {
  require("dotenv").config();
  const first = await fetchPage(0);
  const total = parseInt(first["search-results"]["opensearch:totalResults"]);
  console.log("Total Scopus asserts:", total);
  
  let validPapers = 0;
  for(let i = 0; i < 500; i+=100) {
      console.log(`Fetching ${i}...`);
      const page = await fetchPage(i);
      const entries = page["search-results"].entry || [];
      for(const entry of entries) {
          let hasShardaAuthor = false;
          
          const affiliations = entry.affiliation || [];
          let shardaAfid = null;
          for(const aff of affiliations) {
              if (aff.affilname && aff.affilname.toLowerCase().includes("sharda")) {
                  shardaAfid = aff.afid;
                  break;
              }
          }
          
          if (shardaAfid) {
              const authors = entry.author || [];
              for(const author of authors) {
                  if (author.afid && author.afid.some(a => a["$"] === shardaAfid)) {
                      hasShardaAuthor = true;
                      break;
                  }
              }
          }
          
          if (hasShardaAuthor) validPapers++;
      }
  }
  console.log(`Out of first 500, ${validPapers} had Sharda authors.`);
}

run();
