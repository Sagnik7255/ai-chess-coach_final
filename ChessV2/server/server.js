const mongoose = require("mongoose");
const cors = require("cors");
const express = require("express");

const Game = require("./models/Game");

const app = express();
require("dotenv").config({ path: __dirname + "/.env" });

app.use(express.json());

app.use(cors());

if (!process.env.MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable");
}

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB Atlas Connected");

    app.listen(3000, () => {
      console.log("🚀 Server running on port 3000");
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB Error:", err.message);
  });

// =======================
// ✅ SIGNUP
// =======================
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await Game.findOne({ email });

    if (existingUser) {
      return res.json({ message: "User already exists" });
    }

    const user = new Game({ name, email, password });
    await user.save();

    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error("❌ Signup Error:", err.message);
    res.json({ error: err.message });
  }
});

// =======================
// ✅ LOGIN
// =======================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Game.findOne({ email });

    if (!user) {
      return res.json({ message: "User not found" });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.json({ message: "Invalid password" });
    }

    res.json({ message: "Login successful" });

  } catch (err) {
    console.error(err);
    res.json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("AI Chess Coach Server Running 🚀");
});

const API_KEY = process.env.GROQ_API_KEY;

app.post("/api/chat", async (req, res) => {
  console.log("🔥 /api/chat HIT");

  try {
    if (!API_KEY) {
      return res.status(500).json({ reply: "AI service is not configured." });
    }

    const { message, fen } = req.body;

    const prompt = `
You are a professional chess coach.

Position (FEN): ${fen}

${message}

Explain clearly for a beginner.
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
        }),
      },
    );

    console.log("📡 OpenAI status:", response.status);

    const text = await response.text(); // 👈 IMPORTANT CHANGE
    console.log("📦 RAW RESPONSE:", text);

    const data = JSON.parse(text);

    if (!data.choices) {
      return res.json({
        reply: "⚠️ OpenAI Error: " + text,
      });
    }

    res.json({
      reply: data.choices[0].message.content,
    });
  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.json({
      reply: "⚠️ Server crashed: " + err.message,
    });
  }
});

app.post("/explain-move", (req, res) => {
  const { command } = req.body;

  console.log("🎤 Received:", command);

  // 🔥 Replace later with your real AI
  let response = "";

  if (command.toLowerCase().includes("best move")) {
    response = "The best move here is knight to f3.";
  } else if (command.toLowerCase().includes("explain")) {
    response = "This move controls the center and improves your position.";
  } else {
    response = "I heard you say " + command;
  }

  res.json({ response });
});