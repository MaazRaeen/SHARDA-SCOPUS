const https = require("https");
require("dotenv").config();

const apiKey = process.env.SCOPUS_API_KEY;
const affilId = "60108680";

function fetchAffiliationDetails() {
  return new Promise((resolve, reject) => {
    const url = `https://api.elsevier.com/content/affiliation/affiliation_id/${affilId}`;
    console.log(`Fetching affiliation details from: ${url}`);
    
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
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

async function run() {
  try {
    const response = await fetchAffiliationDetails();
    console.log("Full response:", JSON.stringify(response, null, 2));
    if (response["affiliation-retrieval-response"]) {
      const data = response["affiliation-retrieval-response"];
    } else {
      console.log("Unexpected response format");
    }
  } catch (error) {
    console.error("Error fetching affiliation details:", error);
  }
}

run();
