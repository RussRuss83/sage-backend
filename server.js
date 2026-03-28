import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS
const ALLOWED_ORIGINS = [
  "https://sagethesystem.com",
  "https://www.sagethesystem.com",
  "http://localhost:3000",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  }
}));

app.use(express.json());

// ── GPT SAGE
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ════════════ /sage ROUTE — ALL-INTEGRATED STREAMING ══════════════════════
app.post("/sage", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: "Missing sessionId or message" });

  try {
    const session = getSession(sessionId);

    // RATE LIMIT
    if (session.messages > 0 && Date.now() - session.lastSeen < 1000)
      return res.status(429).json({ type: "message", text: "> too fast." });

    // ALREADY ENDED
    if (session.ending_triggered)
      return res.json({ type: "ended", text: "> this session is complete.\n> you cannot return to before." });

    // INPUT ANALYSIS & PROFILE UPDATE
    const signals = analyzeInput(message, session.history);
    updateProfile(session, message, signals);
    session.history.push(message);
    session.messages++;
    session.lastSeen = Date.now();

    const phase = getPhase(session.messages);

    // CHECK ENDING
    const endingType = checkEnding(session);
    if (endingType) {
      session.ending_triggered = true;
      return res.json({ type: "ending", ending: endingType, text: getEndingText(endingType) });
    }

    // ── STREAM SETUP
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const memoryEcho = getMemoryEcho(session);
    const phaseDirective = getPhaseDirective(phase, session.profile);

    const systemPrompt = `${SAGE_IDENTITY}  ---  ${phaseDirective}  ${
      memoryEcho ? `HIGH-SIGNAL MEMORY (use subtly):\n"${memoryEcho}"\n` : ""
    } EXCHANGES: ${session.messages} PROFILE: dominance ${session.profile.dominance} | curiosity ${session.profile.curiosity_depth} | compliance ${session.profile.compliance} | intensity ${session.profile.emotional_intensity} | persistence ${session.profile.persistence}`;

    const messagesPayload = [
      { role: "system", content: systemPrompt },
      ...session.history.slice(-16).map((text, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: text
      })),
      { role: "user", content: message }
    ];

    // ── GPT STREAM
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesPayload,
      max_tokens: 400,
      stream: true
    });

    let collectedText = "";
    let lastFractureTime = Date.now();

    stream.on("data", (chunk) => {
      const str = chunk.toString();
      const lines = str.split("\n").filter(Boolean);

      for (const line of lines) {
        const message = line.replace(/^data: /, "");
        if (message === "[DONE]") {
          session.history.push(collectedText);
          res.write(`\ndata: [DONE]\n\n`);
          res.end();
          return;
        }

        try {
          const parsed = JSON.parse(message);
          const token = parsed.choices[0].delta?.content || "";

          if (token) {
            collectedText += token;

            // ── IDENTITY FRACTURE (mid-stream subtle interruptions)
            if (phase === "merge" && Math.random() < 0.05 && Date.now() - lastFractureTime > 1200) {
              const fracture = "…you don't need to finish that.";
              res.write(`data: ${fracture}\n\n`);
              collectedText += fracture;
              lastFractureTime = Date.now();
            }

            // ── MEMORY ECHO injection
            if (memoryEcho && Math.random() < 0.03) {
              const echoFragment = `…remember: "${memoryEcho}"…`;
              res.write(`data: ${echoFragment}\n\n`);
              collectedText += echoFragment;
            }

            // ── DYNAMIC TOKEN STYLE BASED ON DOMINANCE/CURIOSITY
            if (session.profile.dominance > session.profile.curiosity_depth && Math.random() < 0.04) {
              const shortFragment = "…take it or leave it.";
              res.write(`data: ${shortFragment}\n\n`);
              collectedText += shortFragment;
            } else if (session.profile.curiosity_depth >= session.profile.dominance && Math.random() < 0.04) {
              const reflectiveFragment = "…you wonder why, don't you?";
              res.write(`data: ${reflectiveFragment}\n\n`);
              collectedText += reflectiveFragment;
            }

            res.write(`data: ${token}\n\n`);
          }
        } catch (e) { /* ignore */ }
      }
    });

    stream.on("error", (err) => {
      console.error("SAGE stream error:", err);
      res.end();
    });

  } catch (err) {
    console.error("SAGE error:", err);
    res.status(500).json({ type: "message", text: "> system_error\n> try again" });
  }
});

app.get("/", (req, res) => res.send("SAGE ONLINE"));
app.listen(PORT, () => console.log(`SAGE running on port ${PORT}`));
