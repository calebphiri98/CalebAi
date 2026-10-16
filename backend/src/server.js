require('dotenv').config();
const express = require('express');
const cors = require('cors');
const aiRoutes = require('./routes/ai.routes.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Mount the AI routes under /api
app.use('/api', aiRoutes);

app.get('/', (req, res) => {
    res.send('Caleb AI Backend is running.');
});

app.listen(PORT, () => {
    console.log(`Caleb AI backend running on http://localhost:${PORT}`);
});