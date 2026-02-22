// ════════════════════════════════════════════════════════
//  AI Flashcard — script.js
//  Connects your HTML UI to the Express + Gemini backend
// ════════════════════════════════════════════════════════

const API = '/api';

// ── State ────────────────────────────────────────────────
let decks = [];
let currentDeckId = null;
let currentCards = [];
let currentIndex = 0;
let isFlipped = false;

// ── DOM Refs ─────────────────────────────────────────────
const deckList         = document.getElementById('deckList');
const currentDeckTitle = document.getElementById('currentDeckTitle');
const emptyState       = document.getElementById('emptyState');
const flashcardDisplay = document.getElementById('flashcardDisplay');
const flashcard        = document.getElementById('flashcard');
const cardQuestion     = document.getElementById('cardQuestion');
const cardAnswer       = document.getElementById('cardAnswer');
const cardTagsFront    = document.getElementById('cardTagsFront');
const cardTagsBack     = document.getElementById('cardTagsBack');
const cardProgress     = document.getElementById('cardProgress');
const reviewButtons    = document.getElementById('reviewButtons');
const loadingOverlay   = document.getElementById('loadingOverlay');
const loadingText      = document.getElementById('loadingText');
const aiInput          = document.getElementById('aiInput');

// Stats
const deckCount      = document.getElementById('deckCount');
const totalCards     = document.getElementById('totalCards');

// ── API Helpers ──────────────────────────────────────────
async function apiFetch(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Toast Messages ───────────────────────────────────────
function showMessage(text, type = 'success') {
  const el = document.createElement('div');
  el.className = `message ${type}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ── Loading ──────────────────────────────────────────────
function showLoading(text = 'Generating flashcards with AI...') {
  loadingText.textContent = text;
  loadingOverlay.style.display = 'flex';
}
function hideLoading() {
  loadingOverlay.style.display = 'none';
}

// ════════════════════════════════════════════════════════
//  DECKS
// ════════════════════════════════════════════════════════

async function loadDecks() {
  try {
    const data = await apiFetch('GET', '/decks');
    decks = data.decks;
    renderDeckList();
    updateGlobalStats();
  } catch (err) {
    showMessage('Could not load decks. Is the server running?', 'error');
  }
}

function renderDeckList() {
  deckList.innerHTML = '';
  if (decks.length === 0) {
    deckList.innerHTML = '<div style="color:rgba(255,255,255,0.4); text-align:center; padding:20px; font-size:14px;">No decks yet. Create one!</div>';
    return;
  }
  decks.forEach(deck => {
    const item = document.createElement('div');
    item.className = 'deck-item' + (deck.id === currentDeckId ? ' active' : '');
    item.innerHTML = `
      <div class="deck-header">
        <div class="deck-name">${deck.title}</div>
        <button class="deck-delete" data-id="${deck.id}" title="Delete deck">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <div class="deck-meta">
        <span>${deck.description || 'No description'}</span>
      </div>
      <div class="deck-stats-badge">${deck.cardCount} cards</div>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.deck-delete')) return;
      selectDeck(deck.id);
    });
    item.querySelector('.deck-delete').addEventListener('click', () => deleteDeck(deck.id));
    deckList.appendChild(item);
  });
}

async function selectDeck(id) {
  currentDeckId = id;
  currentIndex = 0;
  isFlipped = false;

  try {
    const data = await apiFetch('GET', `/decks/${id}`);
    currentCards = data.cards;
    const deck = data.deck;

    currentDeckTitle.textContent = deck.title;
    renderDeckList(); // re-render to update active state
    updateGlobalStats();
    renderCard();
  } catch (err) {
    showMessage('Failed to load deck.', 'error');
  }
}

async function deleteDeck(id) {
  if (!confirm('Delete this deck and all its cards?')) return;
  try {
    await apiFetch('DELETE', `/decks/${id}`);
    if (currentDeckId === id) {
      currentDeckId = null;
      currentCards = [];
      currentDeckTitle.textContent = 'Select a Deck';
      showEmptyState();
    }
    await loadDecks();
    showMessage('Deck deleted.');
  } catch (err) {
    showMessage('Failed to delete deck.', 'error');
  }
}

function updateGlobalStats() {
  deckCount.textContent = decks.length;
  const total = decks.reduce((sum, d) => sum + (d.cardCount || 0), 0);
  totalCards.textContent = total;
}

// New Deck Modal
const newDeckModal   = document.getElementById('newDeckModal');
const deckNameInput  = document.getElementById('deckNameInput');
const deckDescInput  = document.getElementById('deckDescInput');

document.getElementById('newDeckBtn').addEventListener('click', () => {
  deckNameInput.value = '';
  deckDescInput.value = '';
  newDeckModal.classList.add('active');
  deckNameInput.focus();
});
document.getElementById('closeDeckModal').addEventListener('click', () => newDeckModal.classList.remove('active'));
document.getElementById('cancelDeckBtn').addEventListener('click', () => newDeckModal.classList.remove('active'));

document.getElementById('createDeckBtn').addEventListener('click', async () => {
  const title = deckNameInput.value.trim();
  const description = deckDescInput.value.trim();
  if (!title) { showMessage('Please enter a deck name.', 'error'); return; }

  try {
    const data = await apiFetch('POST', '/decks', { title, description });
    newDeckModal.classList.remove('active');
    await loadDecks();
    selectDeck(data.deck.id);
    showMessage(`Deck "${title}" created!`);
  } catch (err) {
    showMessage('Failed to create deck.', 'error');
  }
});

// ════════════════════════════════════════════════════════
//  FLASHCARD DISPLAY
// ════════════════════════════════════════════════════════

function showEmptyState() {
  emptyState.style.display = 'flex';
  flashcardDisplay.style.display = 'none';
}

function renderCard() {
  if (currentCards.length === 0) {
    showEmptyState();
    return;
  }

  emptyState.style.display = 'none';
  flashcardDisplay.style.display = 'block';

  // Reset flip
  isFlipped = false;
  flashcard.classList.remove('flipped');
  reviewButtons.style.display = 'none';

  const card = currentCards[currentIndex];
  cardQuestion.textContent = card.question;
  cardAnswer.textContent = card.answer;
  cardProgress.textContent = `Card ${currentIndex + 1} of ${currentCards.length}`;

  // Tags
  const tagHTML = (card.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
  cardTagsFront.innerHTML = tagHTML;
  cardTagsBack.innerHTML = tagHTML;
}

// Flip
flashcard.addEventListener('click', flipCard);
document.getElementById('flipBtn').addEventListener('click', flipCard);

function flipCard() {
  isFlipped = !isFlipped;
  flashcard.classList.toggle('flipped', isFlipped);
  reviewButtons.style.display = isFlipped ? 'flex' : 'none';
}

// Navigation
document.getElementById('prevBtn').addEventListener('click', () => {
  if (currentIndex > 0) { currentIndex--; renderCard(); }
});
document.getElementById('nextBtn').addEventListener('click', () => {
  if (currentIndex < currentCards.length - 1) { currentIndex++; renderCard(); }
});

// Space bar to flip
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); flipCard(); }
  if (e.code === 'ArrowLeft') { if (currentIndex > 0) { currentIndex--; renderCard(); } }
  if (e.code === 'ArrowRight') { if (currentIndex < currentCards.length - 1) { currentIndex++; renderCard(); } }
});

// Review buttons (simple next-card for now — extend with SRS logic if desired)
document.getElementById('againBtn').addEventListener('click', () => { renderCard(); }); // stay on same card
document.getElementById('hardBtn').addEventListener('click', nextCard);
document.getElementById('goodBtn').addEventListener('click', nextCard);
document.getElementById('easyBtn').addEventListener('click', nextCard);

function nextCard() {
  if (currentIndex < currentCards.length - 1) {
    currentIndex++;
    renderCard();
  } else {
    showMessage('🎉 You finished this deck!', 'info');
    currentIndex = 0;
    renderCard();
  }
}

// ════════════════════════════════════════════════════════
//  AI GENERATION
// ════════════════════════════════════════════════════════

async function generateCards(topic) {
  if (!currentDeckId) {
    showMessage('Please select or create a deck first.', 'error');
    return;
  }
  if (!topic.trim()) {
    showMessage('Please enter a topic.', 'error');
    return;
  }

  showLoading(`Generating cards about "${topic}"...`);
  try {
    const data = await apiFetch('POST', '/generate', {
      deckId: currentDeckId,
      topic: topic.trim(),
      count: 5,
    });

    currentCards = [...currentCards, ...data.cards];
    currentIndex = currentCards.length - data.cards.length; // jump to first new card

    // Update deck card count in list
    const deck = decks.find(d => d.id === currentDeckId);
    if (deck) deck.cardCount = data.total;
    renderDeckList();
    updateGlobalStats();
    renderCard();
    showMessage(`✅ ${data.cards.length} cards generated!`);
  } catch (err) {
    showMessage('Generation failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// Send button & Enter key in textarea
document.getElementById('sendBtn').addEventListener('click', () => {
  generateCards(aiInput.value);
  aiInput.value = '';
});

aiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    generateCards(aiInput.value);
    aiInput.value = '';
  }
});

// "Generate with AI" from empty state
document.getElementById('aiGenerateBtn').addEventListener('click', () => {
  aiInput.focus();
});

// "More AI" button in card controls
document.getElementById('aiGenerateFromHereBtn').addEventListener('click', () => {
  aiInput.focus();
});

// ════════════════════════════════════════════════════════
//  MANUAL CARD MODAL
// ════════════════════════════════════════════════════════

const manualCardModal = document.getElementById('manualCardModal');
const manualQuestion  = document.getElementById('manualQuestion');
const manualAnswer    = document.getElementById('manualAnswer');
const manualTags      = document.getElementById('manualTags');

function openManualModal() {
  if (!currentDeckId) { showMessage('Please select or create a deck first.', 'error'); return; }
  manualQuestion.value = '';
  manualAnswer.value = '';
  manualTags.value = '';
  manualCardModal.classList.add('active');
  manualQuestion.focus();
}

document.getElementById('manualCreateBtn').addEventListener('click', openManualModal);
document.getElementById('addManualBtn').addEventListener('click', openManualModal);
document.getElementById('closeManualModal').addEventListener('click', () => manualCardModal.classList.remove('active'));
document.getElementById('cancelManualCard').addEventListener('click', () => manualCardModal.classList.remove('active'));

document.getElementById('saveManualCard').addEventListener('click', async () => {
  const question = manualQuestion.value.trim();
  const answer   = manualAnswer.value.trim();
  const tags     = manualTags.value.split(',').map(t => t.trim()).filter(Boolean);

  if (!question || !answer) { showMessage('Question and answer are required.', 'error'); return; }

  try {
    const data = await apiFetch('POST', `/decks/${currentDeckId}/cards`, { question, answer, tags });
    currentCards.push(data.card);
    currentIndex = currentCards.length - 1;

    const deck = decks.find(d => d.id === currentDeckId);
    if (deck) deck.cardCount += 1;
    renderDeckList();
    updateGlobalStats();
    renderCard();

    manualCardModal.classList.remove('active');
    showMessage('Card added!');
  } catch (err) {
    showMessage('Failed to add card.', 'error');
  }
});

// ════════════════════════════════════════════════════════
//  DELETE CARD
// ════════════════════════════════════════════════════════

document.getElementById('deleteCardBtn').addEventListener('click', async () => {
  if (currentCards.length === 0) return;
  const card = currentCards[currentIndex];
  if (!confirm('Delete this card?')) return;

  try {
    await apiFetch('DELETE', `/cards/${card.id}`);
    currentCards.splice(currentIndex, 1);

    const deck = decks.find(d => d.id === currentDeckId);
    if (deck) deck.cardCount = Math.max(0, deck.cardCount - 1);
    renderDeckList();
    updateGlobalStats();

    if (currentIndex >= currentCards.length) currentIndex = Math.max(0, currentCards.length - 1);
    renderCard();
    showMessage('Card deleted.');
  } catch (err) {
    showMessage('Failed to delete card.', 'error');
  }
});

// ════════════════════════════════════════════════════════
//  AI CONFIG MODAL (hide Ollama fields — not applicable)
// ════════════════════════════════════════════════════════

const aiConfigModal = document.getElementById('aiConfigModal');
document.getElementById('aiConfigBtn').addEventListener('click', () => aiConfigModal.classList.add('active'));
document.getElementById('closeAIConfigModal').addEventListener('click', () => aiConfigModal.classList.remove('active'));
document.getElementById('cancelAIConfig').addEventListener('click', () => aiConfigModal.classList.remove('active'));
document.getElementById('saveAIConfig').addEventListener('click', () => {
  aiConfigModal.classList.remove('active');
  showMessage('Settings saved (model is fixed to gemini-3-flash-preview on server).', 'info');
});
document.getElementById('resetAIConfig').addEventListener('click', () => {
  showMessage('Config reset.', 'info');
});

// Close modals on backdrop click
[newDeckModal, manualCardModal, aiConfigModal].forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });
});

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════

(async () => {
  showEmptyState();
  await loadDecks();
})();
