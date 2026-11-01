/**
 * popup.js — SketchMind AI  (Milestone 2)
 *
 * Popup responsibilities:
 *  - Toggle drawing mode on the active tab
 *  - Sync tool, color, and pen-width to the content script
 *  - Restore persisted state on popup open
 *  - Listen for state-change messages sent back from content.js
 *    (e.g. user pressed Esc on-page to exit drawing mode)
 */

'use strict';

/* ── DOM refs ─────────────────────────────────────────────── */
const toggleDrawBtn   = document.getElementById('toggleDrawBtn');
const toggleDrawLabel = document.getElementById('toggleDrawLabel');
const openExplainBtn  = document.getElementById('openExplainBtn');
const toolsSection    = document.getElementById('toolsSection');
const statusDot       = document.getElementById('statusDot');
const statusText      = document.getElementById('statusText');
const widthSlider     = document.getElementById('widthSlider');
const widthValue      = document.getElementById('widthValue');

/* ── State ────────────────────────────────────────────────── */
let drawingActive = false;
let currentTool   = 'pen';
let currentColor  = '#ef4444';
let currentWidth  = 4;

/* ══════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════ */

/**
 * Send a message to the content script on the active tab.
 * Returns the response object, or null if the message failed
 * (e.g. restricted page, content script not yet ready).
 *
 * @param {object} message
 * @returns {Promise<object|null>}
 */
async function sendToActiveTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      setStatus('No active tab.', 'error');
      return null;
    }

    // chrome://, chrome-extension://, about:, file:// (unless enabled) — all restricted
    if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
      setStatus('Cannot run on this page.', 'error');
      return null;
    }

    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response ?? null;
  } catch (err) {
    console.warn('[SketchMind popup]', err.message);
    setStatus('Reload the page and try again.', 'error');
    return null;
  }
}

/**
 * Update the status indicator bar.
 * @param {string} text
 * @param {'idle'|'active'|'error'} state
 */
function setStatus(text, state = 'idle') {
  statusText.textContent = text;
  statusDot.className = 'status-dot';
  if (state === 'active') statusDot.classList.add('active');
  if (state === 'error')  statusDot.classList.add('error');
}

/** Persist current UI state so it survives popup close/re-open. */
function saveState() {
  chrome.storage.local.set({ drawingActive, currentTool, currentColor, currentWidth });
}

/**
 * Apply drawing-mode UI changes (label, button style, tools panel, status).
 * Does NOT communicate with content script.
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

/* ══════════════════════════════════════════════════════════
   Drawing mode toggle
   ══════════════════════════════════════════════════════════ */
toggleDrawBtn.addEventListener('click', async () => {
  const next = !drawingActive;

  // Optimistic UI update
  applyDrawingUI(next);

  const response = await sendToActiveTab({
    type:      'SKETCHMIND_TOGGLE_DRAW',
    active:    next,
    tool:      currentTool,
    color:     currentColor,
    lineWidth: currentWidth,
  });

  if (response === null) {
    // Roll back if message failed
    applyDrawingUI(!next);
    return;
  }

  saveState();
});

/* ══════════════════════════════════════════════════════════
   Explanation panel
   ══════════════════════════════════════════════════════════ */
openExplainBtn.addEventListener('click', async () => {
  const response = await sendToActiveTab({ type: 'SKETCHMIND_OPEN_PANEL' });

  if (response !== null) {
    setStatus('Explanation panel opened.', 'active');
    setTimeout(() => {
      setStatus(drawingActive ? 'Drawing mode on' : 'Ready', drawingActive ? 'active' : 'idle');
    }, 2000);
  }
});

/* ══════════════════════════════════════════════════════════
   Tool buttons (pen / highlight / eraser / clear)
   ══════════════════════════════════════════════════════════ */
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;

    if (tool === 'clear') {
      sendToActiveTab({ type: 'SKETCHMIND_CLEAR' });
      return;
    }

    currentTool = tool;

    document.querySelectorAll('.tool-btn').forEach(b => {
      const isActive = b.dataset.tool === tool;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });

    sendToActiveTab({ type: 'SKETCHMIND_SET_TOOL', tool, color: currentColor, lineWidth: currentWidth });
    saveState();
  });
});

/* ══════════════════════════════════════════════════════════
   Color buttons
   ══════════════════════════════════════════════════════════ */
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentColor = btn.dataset.color;

    document.querySelectorAll('.color-btn').forEach(b => {
      const isActive = b.dataset.color === currentColor;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });

    sendToActiveTab({ type: 'SKETCHMIND_SET_TOOL', tool: currentTool, color: currentColor, lineWidth: currentWidth });
    saveState();
  });
});

/* ══════════════════════════════════════════════════════════
   Pen-width slider
   ══════════════════════════════════════════════════════════ */
widthSlider.addEventListener('input', () => {
  currentWidth = Number(widthSlider.value);
  widthValue.textContent = currentWidth + 'px';
  sendToActiveTab({ type: 'SKETCHMIND_SET_TOOL', tool: currentTool, color: currentColor, lineWidth: currentWidth });
  saveState();
});

/* ══════════════════════════════════════════════════════════
   Listen for messages FROM the content script
   (e.g. user pressed Esc in drawing mode → exit notification)
   ══════════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'SKETCHMIND_DRAW_EXITED':
      applyDrawingUI(false);
      saveState();
      break;
    case 'SKETCHMIND_TOOL_CHANGED':
      if (msg.tool) {
        currentTool = msg.tool;
        document.querySelectorAll('.tool-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.tool === currentTool);
        });
        saveState();
      }
      break;
    case 'SKETCHMIND_COLOR_CHANGED':
      if (msg.color) {
        currentColor = msg.color;
        document.querySelectorAll('.color-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.color === currentColor);
        });
        saveState();
      }
      break;
    case 'SKETCHMIND_WIDTH_CHANGED':
      if (msg.lineWidth) {
        currentWidth = msg.lineWidth;
        widthSlider.value = currentWidth;
        widthValue.textContent = currentWidth + 'px';
        saveState();
      }
      break;
  }
});

/* ══════════════════════════════════════════════════════════
   Restore persisted state on popup open
   ══════════════════════════════════════════════════════════ */
(async () => {
  const stored = await chrome.storage.local.get([
    'drawingActive', 'currentTool', 'currentColor', 'currentWidth',
  ]);

  if (stored.currentColor) {
    currentColor = stored.currentColor;
    document.querySelectorAll('.color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === currentColor);
    });
  }

  if (stored.currentTool) {
    currentTool = stored.currentTool;
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === currentTool);
    });
  }

  if (stored.currentWidth) {
    currentWidth = stored.currentWidth;
    widthSlider.value = currentWidth;
    widthValue.textContent = currentWidth + 'px';
  }

  // Re-check actual drawing state from the content script
  // (popup may re-open after user pressed Esc on page)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url && !/^(chrome|chrome-extension|about):/.test(tab.url)) {
      const state = await chrome.tabs.sendMessage(tab.id, { type: 'SKETCHMIND_GET_STATE' });
      if (state?.ok) {
        applyDrawingUI(state.active);
        return;
      }
    }
  } catch (_) { /* content script not ready yet — use stored state */ }

  applyDrawingUI(stored.drawingActive ?? false);
})();
