const express = require('express');
const app = express();
app.use(express.json());

let records = []; // Temporary storage

app.post('https://deverp.shantipatra.com/api/production-rolls', (req, res) => {
    const record = req.body;
    records.push(record);
    res.json({ message: "Record saved successfully!", data: record });
});

app.listen(5000, () => console.log("Server running on port 5000"));
