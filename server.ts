import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // ── Gemini Setup ───────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not defined in the environment.");
  }
  const ai = new GoogleGenAI({ apiKey: apiKey || '' });

  // ── In-Memory Store ────────────────────────────────────────
  const decks = new Map<string, any>();
  const cards = new Map<string, any>();

  // ── Middleware ─────────────────────────────────────────────
  app.use(cors());
  app.use(express.json());

  // ── Helpers ────────────────────────────────────────────────
  const getDeckCards = (deckId: string) =>
    [...cards.values()]
      .filter((c) => c.deckId === deckId)
      .sort((a, b) => a.position - b.position);

  // ── API ROUTES ─────────────────────────────────────────────
  
  app.get('/api/health', (req, res) => res.json({ status: 'ok', model: 'gemini-3-flash-preview' }));

  // DECKS
  app.get('/api/decks', (req, res) => {
    const all = [...decks.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, decks: all });
  });

  app.get('/api/decks/:id', (req, res) => {
    const deck = decks.get(req.params.id);
    if (!deck) return res.status(404).json({ success: false, error: 'Deck not found.' });
    res.json({ success: true, deck, cards: getDeckCards(deck.id) });
  });

  app.post('/api/decks', (req, res) => {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Title is required.' });
    const id = uuidv4();
    const deck = { id, title, description: description || '', cardCount: 0, createdAt: new Date().toISOString() };
    decks.set(id, deck);
    res.status(201).json({ success: true, deck });
  });

  app.delete('/api/decks/:id', (req, res) => {
    if (!decks.has(req.params.id)) return res.status(404).json({ success: false, error: 'Deck not found.' });
    decks.delete(req.params.id);
    for (const [cardId, card] of cards.entries()) {
      if (card.deckId === req.params.id) cards.delete(cardId);
    }
    res.json({ success: true });
  });

  // AI GENERATION
  app.post('/api/generate', async (req, res) => {
    try {
      const { deckId, topic, count = 5 } = req.body;
      if (!topic) return res.status(400).json({ success: false, error: 'Topic is required.' });
      if (!deckId || !decks.has(deckId)) return res.status(400).json({ success: false, error: 'Valid deckId is required.' });

      const prompt = `You are an expert educator. Generate ${count} educational flashcards about: "${topic}".

Respond ONLY with a valid JSON array — no markdown, no extra text.

Format:
[
  {
    "question": "Clear, specific question",
    "answer": "Concise, accurate answer",
    "tags": ["tag1", "tag2"]
  }
]`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const raw = response.text.trim();
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const aiCards = JSON.parse(clean);

      if (!Array.isArray(aiCards)) throw new Error('AI did not return a valid array.');

      const deck = decks.get(deckId);
      const existingCount = getDeckCards(deckId).length;
      const newCards: any[] = [];

      aiCards.forEach((card, i) => {
        const id = uuidv4();
        const newCard = {
          id, deckId,
          question: card.question,
          answer: card.answer,
          tags: Array.isArray(card.tags) ? card.tags : [],
          position: existingCount + i,
          createdAt: new Date().toISOString(),
        };
        cards.set(id, newCard);
        newCards.push(newCard);
      });

      deck.cardCount = getDeckCards(deckId).length;
      res.json({ success: true, cards: newCards, total: deck.cardCount });
    } catch (err: any) {
      console.error('[Generate Error]', err.message);
      res.status(500).json({ success: false, error: 'AI generation failed: ' + err.message });
    }
  });

  // CARDS
  app.post('/api/decks/:deckId/cards', (req, res) => {
    const deck = decks.get(req.params.deckId);
    if (!deck) return res.status(404).json({ success: false, error: 'Deck not found.' });
    const { question, answer, tags = [] } = req.body;
    if (!question || !answer) return res.status(400).json({ success: false, error: 'Question and answer are required.' });
    const id = uuidv4();
    const card = { id, deckId: deck.id, question, answer, tags, position: getDeckCards(deck.id).length, createdAt: new Date().toISOString() };
    cards.set(id, card);
    deck.cardCount += 1;
    res.status(201).json({ success: true, card });
  });

  app.delete('/api/cards/:id', (req, res) => {
    const card = cards.get(req.params.id);
    if (!card) return res.status(404).json({ success: false, error: 'Card not found.' });
    const deck = decks.get(card.deckId);
    if (deck) deck.cardCount = Math.max(0, deck.cardCount - 1);
    cards.delete(req.params.id);
    res.json({ success: true });
  });

  // ── VITE MIDDLEWARE (DEV) ──────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve static files
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 AI Flashcard server running at http://localhost:${PORT}`);
  });
}

startServer();