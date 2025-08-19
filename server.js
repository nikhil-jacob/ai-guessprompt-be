const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

const leaderboardPath = "leaderboard.json";
let lastPrompt = "";
let currentImage = "";

// Ensure leaderboard file exists
if (!fs.existsSync(leaderboardPath)) {
  fs.writeFileSync(leaderboardPath, JSON.stringify([]));
}

// Gemini API Key
const GEMINI_API_KEY = "";

if (!GEMINI_API_KEY) {
  console.error("❌ Please set GEMINI_API_KEY");
  process.exit(1);
}

// Generate new game prompt & image
async function generatePromptAndImage() {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Generate a short, creative art prompt (max 12 words) for an image guessing game, and provide the image itself."
              }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      })
    }
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const promptText = parts.find(p => p.text)?.text?.trim();
  const imagePart = parts.find(p => p.inlineData);
  const imageData = imagePart?.inlineData?.data;
  const mimeType = imagePart?.inlineData?.mimeType || "image/png";

  if (!promptText || !imageData) throw new Error("Gemini did not return prompt or image");

  lastPrompt = promptText;
  currentImage = `data:${mimeType};base64,${imageData}`;

  return { prompt: promptText, image: currentImage };
}

// Generate image from a given prompt (for user guess)
async function generateImageFromPrompt(promptText) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `provide the image for the prompt: ${promptText}`
              }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      })
    }
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData);
  const imageData = imagePart?.inlineData?.data;
  const mimeType = imagePart?.inlineData?.mimeType || "image/png";

  if (!imageData) throw new Error("Gemini did not return prompt or image");

  return `data:${mimeType};base64,${imageData}`;
}

// Simple word overlap score
function similarityScore(guess, targetPrompt) {
  const guessWords = guess.toLowerCase().split(/\s+/);
  const targetWords = targetPrompt.toLowerCase().split(/\s+/);
  const commonWords = guessWords.filter(word => targetWords.includes(word));
  return Math.round((commonWords.length / targetWords.length) * 100);
}

// Route: Get fresh prompt + image
app.get("/prompt", async (req, res) => {
  try {
    const result = await generatePromptAndImage();
    res.json({ image: result.image });
  } catch (err) {
    console.error("Error in /prompt:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Route: Get leaderboard
app.get("/leaderboard", (req, res) => {
  const leaderboard = JSON.parse(fs.readFileSync(leaderboardPath));
  res.json(leaderboard);
});

// Route: Submit guess (single player)
app.post("/guess", async (req, res) => {
  const { name, guess } = req.body;
  if (!name || !guess) {
    return res.status(400).json({ error: "Missing name or guess" });
  }
  if (!lastPrompt) {
    return res.status(400).json({ error: "No prompt available yet" });
  }

  const score = similarityScore(guess, lastPrompt);
  const leaderboard = JSON.parse(fs.readFileSync(leaderboardPath));
  leaderboard.push({ name, guess, prompt: lastPrompt, score, date: new Date().toISOString() });
  leaderboard.sort((a, b) => b.score - a.score);
  fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));

  let guessImage = null;
  try {
    guessImage = await generateImageFromPrompt(guess);
  } catch (err) {
    console.error("Error generating images:", err);
  }

  res.json({
    score,
    leaderboard,
    aiImage: currentImage,
    guessImage,
  });
});

// Route: Submit group guesses
app.post("/guess-group", async (req, res) => {
  const { players } = req.body;

  if (!Array.isArray(players) || players.length < 2 || players.length > 5) {
    return res.status(400).json({ error: "Players must be an array between 2 and 5 members" });
  }
  if (!lastPrompt) {
    return res.status(400).json({ error: "No prompt available yet" });
  }

  // Calculate scores
  const scores = players.map(p => ({
    name: p.name,
    guess: p.guess,
    score: similarityScore(p.guess, lastPrompt),
  }));

  // Save to leaderboard
  const leaderboard = JSON.parse(fs.readFileSync(leaderboardPath));
  scores.forEach(s => {
    leaderboard.push({ ...s, prompt: lastPrompt, date: new Date().toISOString() });
  });
  leaderboard.sort((a, b) => b.score - a.score);
  fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));

  // Find top scorer
  const topScorer = scores.reduce((prev, curr) => (curr.score > prev.score ? curr : prev), scores[0]);

  let guessImage = null;
  try {
    guessImage = await generateImageFromPrompt(topScorer.guess);
  } catch (err) {
    console.error("Error generating top scorer image:", err);
  }

  res.json({
    scores: scores.sort((a, b) => b.score - a.score),
    topScorerImage: guessImage,
    aiImage: currentImage,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
