/**
 * popup.js — SketchMind AI
 *
 * Handles all popup UI interactions:
 *  - Toggle drawing mode on the active tab via chrome.tabs.sendMessage
 *  - Open / close the explanation panel
 *  - Sync drawing tool / color selection to content script
 *  - Persist state in chrome.storage.local
 */

'use strict';

/* ── DOM refs ──────────────────────────────────────────────── */
const toggleDrawBtn   = document.getElementById('toggleDrawBtn');
const toggleDrawLabel = document.getElementById('toggleDrawLabel');
const openExplainBtn  = document.getElementById('openExplainBtn');
const toolsSection    = document.getElementById('toolsSection');
const statusDot       = document.getElementById('statusDot');
const statusText      = document.getElementById('statusText');

/* ── State ─────────────────────────────────────────────────── */
let drawingActive = false;
let currentTool   = 'pen';
let currentColor  = '#ef4444';

/* ── Helpers ───────────────────────────────────────────────── */

/**
 * Send a message to the content script on the active tab.
 * Silently swallows errors (e.g. tab is chrome:// URL where
 * content scripts cannot be injected).
 *
 * @param {object} message
 * @returns {Promise<any>}
 */
async function sendToActiveTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('No active tab found.', 'error');
      return null;
    }

    // chrome:// / chrome-extension:// pages block content scripts
    if (tab.url && /^(chrome|chrome-extension|about):/.test(tab.url)) {
      setStatus('Cannot run on this page.', 'error');
      return null;
    }

    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response;
  } catch (err) {
    // Content script may not be ready yet on first load
    console.warn('[SketchMind] sendToActiveTab error:', err.message);
    setStatus('Reload the page and try again.', 'error');
    return null;
  }
}

/**
 * Update the status bar.
 * @param {string} text
 * @param {'idle'|'active'|'error'} state
 */
function setStatus(text, state = 'idle') {
  statusText.textContent = text;
  statusDot.className = 'status-dot';
  if (state === 'active') statusDot.classList.add('active');
  if (state === 'error')  statusDot.classList.add('error');
}

/**
 * Persist key UI state so the popup re-opens in the same state.
 */
function saveState() {
  chrome.storage.local.set({ drawingActive, currentTool, currentColor });
}

/**
 * Apply the drawing-mode UI (button label, tools panel, status).
 * @param {boolean} active
 */
function applyDrawingUI(active) {
  drawingActive = active;
  toggleDrawBtn.setAttribute('aria-pressed', String(active));
  toggleDrawBtn.classList.toggle('active', active);
  toggleDrawLabel.textContent = active ? 'Disable Drawing Mode' : 'Enable Drawing Mode';
  toolsSection.classList.toggle('hidden', !active);
  setStatus(active ? 'Drawing mode on' : 'Ready', active ? 'active' : 'idle');
}

/* ── Drawing Mode Toggle ───────────────────────────────────── */
toggleDrawBtn.addEventListener('click', async () => {
  const next = !drawingActive;
  applyDrawingUI(next);

  const response = await sendToActiveTab({
    type: 'SKETCHMIND_TOGGLE_DRAW',
    active: next,
    tool: currentTool,
    color: currentColor,
  });

  if (response === null) {
    // Revert UI if the message couldn't be delivered
    applyDrawingUI(!next);
    return;
  }

  saveState();
});

/* ── Explanation Panel ─────────────────────────────────────── */
openExplainBtn.addEventListener('click', async () => {
  const response = await sendToActiveTab({ type: 'SKETCHMIND_OPEN_PANEL' });

  if (response !== null) {
    setStatus('Explanation panel opened.', 'active');
    // Auto-reset the status label after 2 s
    setTimeout(() => {
      setStatus(drawingActive ? 'Drawing mode on' : 'Ready', drawingActive ? 'active' : 'idle');
    }, 2000);
  }
});

/* ── Tool Buttons ──────────────────────────────────────────── */
document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;

    if (tool === 'clear') {
      sendToActiveTab({ type: 'SKETCHMIND_CLEAR' });
      return;
    }

    currentTool = tool;

    // Update active state
    document.querySelectorAll('.tool-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });

    sendToActiveTab({ type: 'SKETCHMIND_SET_TOOL', tool, color: currentColor });
    saveState();
  });
});

/* ── Color Buttons ─────────────────────────────────────────── */
document.querySelectorAll('.color-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentColor = btn.dataset.color;

    document.querySelectorAll('.color-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.color === currentColor);
    });

    sendToActiveTab({ type: 'SKETCHMIND_SET_TOOL', tool: currentTool, color: currentColor });
    saveState();
  });
});

/* ── Restore persisted state on open ──────────────────────── */
(async () => {
  const stored = await chrome.storage.local.get(['drawingActive', 'currentTool', 'currentColor']);

  if (stored.currentColor) {
    currentColor = stored.currentColor;
    document.querySelectorAll('.color-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.color === currentColor);
    });
  }

  if (stored.currentTool) {
    currentTool = stored.currentTool;
    document.querySelectorAll('.tool-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === currentTool);
    });
  }

  if (stored.drawingActive) {
    applyDrawingUI(true);
  } else {
    setStatus('Ready', 'idle');
  }
})();
