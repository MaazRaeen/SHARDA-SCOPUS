const https = require("https");
require("dotenv").config();

const apiKey = process.env.SCOPUS_API_KEY;
const affilId = "60108680";

function fetchAuthorCount() {
  return new Promise((resolve, reject) => {
    const url = `https://api.elsevier.com/content/search/author?query=AF-ID(${affilId})&count=0`;
    console.log(`Fetching author count from: ${url}`);
    
    https.get(url, {
      headers: { 
        "X-ELS-APIKey": apiKey, 
        "Accept": "application/json" 
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}. Data: ${data.substring(0, 500)}`));
        }
      });
    }).on("error", reject);
  });
}

async function run() {
  try {
    const response = await fetchAuthorCount();
    if (response["search-results"]) {
      const totalResults = response["search-results"]["opensearch:totalResults"];
      console.log(`\nTotal affiliated authors for Sharda University (ID: ${affilId}): ${totalResults}`);
    } else {
      console.log("Unexpected response format:", JSON.stringify(response, null, 2));
    }
  } catch (error) {
    console.error("Error fetching author count:", error);
  }
}

run();
