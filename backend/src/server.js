const express = require("express");
const cors = require("cors");
require("dotenv").config();

const aiRoutes = require("./routes/ai.routes.js");

const app = express();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// AI routes
app.use("/api/ai", aiRoutes);

// Test route
app.get("/", (req, res) => {
    res.json({
        message: "Caleb AI backend is running!"
    });
});

app.listen(PORT, () => {
    console.log(`Caleb AI backend running on http://localhost:${PORT}`);
});