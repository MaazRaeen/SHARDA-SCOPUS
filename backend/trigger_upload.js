const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function triggerUpload() {
    const csvPath = path.join(__dirname, 'uploads', '1771611839176-926921650.csv');

    if (!fs.existsSync(csvPath)) {
        console.error("CSV file not found:", csvPath);
        return;
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(csvPath));

    console.log("Starting upload request to http://localhost:5000/api/papers/upload...");

    try {
        const response = await axios.post('http://localhost:5000/api/papers/upload', form, {
            headers: {
                ...form.getHeaders()
            },
            maxBodyLength: Infinity
        });
        console.log("Success:", JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error("Error during upload:", err.response ? err.response.data : err.message);
    }
}

triggerUpload();
