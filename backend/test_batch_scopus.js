require('dotenv').config();
const axios = require('axios');

async function test() {
    const doids = ["10.1016/j.envres.2023.117234", "10.1016/j.jclepro.2022.133221"];
    const query = doids.map(d => `DOI(${d})`).join(' OR ');
    
    try {
        const res = await axios.get('https://api.elsevier.com/content/search/scopus', {
            params: {
                query: query,
                apiKey: process.env.SCOPUS_API_KEY,
                count: 25
            }
        });
        
        const entries = res.data['search-results'].entry;
        console.log("Found:", entries.length);
        entries.forEach(e => {
            console.log(e['prism:doi'], "->", e['citedby-count']);
        });
    } catch (e) {
        console.error(e.response ? e.response.data : e.message);
    }
}
test();
