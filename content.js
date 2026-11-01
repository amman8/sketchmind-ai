/**
 * content.js — SketchMind AI
 *
 * Injected into every page (<all_urls>) at document_idle.
 *
 * Responsibilities:
 *  - Listen for messages from popup.js via chrome.runtime.onMessage
 *  - Manage a full-page <canvas> overlay for freehand drawing
 *  - Render the explanation panel sidebar
 *  - Handle drawing tools: pen, eraser, highlighter, clear
 *
 * Architecture notes:
 *  - Zero external dependencies; plain DOM + Canvas 2D API only.
 *  - The canvas sits above all page content (z-index 2147483646)
 *    and uses pointer-events: none when drawing mode is off.
 *  - CSS is loaded via content-styles.css (declared in manifest).
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   Module-level state
   ════════════════════════════════════════════════════════════ */
const STATE = {
  drawingActive: false,
  tool: 'pen',
  color: '#ef4444',
  lineWidth: {
    pen: 3,
    eraser: 24,
    highlight: 16,
  },
  isDrawing: false,
  lastX: 0,
  lastY: 0,
};

/* ════════════════════════════════════════════════════════════
   Canvas overlay
   ════════════════════════════════════════════════════════════ */
let canvas = null;
let ctx    = null;

function createCanvas() {
  if (canvas) return;

  canvas = document.createElement('canvas');
  canvas.id = 'sketchmind-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  resizeCanvas();
  document.body.appendChild(canvas);

  ctx = canvas.getContext('2d');
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  // Pointer events
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup',   onPointerUp);
  canvas.addEventListener('pointerout',  onPointerUp);

  // Keep canvas sized to the viewport
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) return;
  // Preserve existing drawing by copying to offscreen buffer first
  let imgData = null;
  if (ctx && canvas.width > 0 && canvas.height > 0) {
    try { imgData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (_) {}
  }

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  if (ctx && imgData) {
    ctx.putImageData(imgData, 0, 0);
  }

  // Re-apply defaults after resize (canvas state is reset)
  if (ctx) {
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
  }
}

function enableCanvas() {
  if (!canvas) createCanvas();
  canvas.style.pointerEvents = 'all';
  canvas.style.cursor = 'crosshair';
}

function disableCanvas() {
  if (!canvas) return;
  canvas.style.pointerEvents = 'none';
  canvas.style.cursor = 'default';
}

function clearCanvas() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* ── Drawing handlers ──────────────────────────────────────── */
function getToolSettings() {
  const { tool, color } = STATE;

  if (tool === 'eraser') {
    return {
      strokeStyle: 'rgba(0,0,0,1)',
      lineWidth: STATE.lineWidth.eraser,
      globalCompositeOperation: 'destination-out',
      globalAlpha: 1,
    };
  }

  if (tool === 'highlight') {
    return {
      strokeStyle: color,
      lineWidth: STATE.lineWidth.highlight,
      globalCompositeOperation: 'multiply',
      globalAlpha: 0.35,
    };
  }

  // Default: pen
  return {
    strokeStyle: color,
    lineWidth: STATE.lineWidth.pen,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  };
}

function applyToolSettings(settings) {
  ctx.strokeStyle              = settings.strokeStyle;
  ctx.lineWidth                = settings.lineWidth;
  ctx.globalCompositeOperation = settings.globalCompositeOperation;
  ctx.globalAlpha              = settings.globalAlpha;
}

function onPointerDown(e) {
  if (!STATE.drawingActive) return;
  STATE.isDrawing = true;
  STATE.lastX = e.clientX;
  STATE.lastY = e.clientY;

  // Capture the pointer so we track moves outside the canvas
  canvas.setPointerCapture(e.pointerId);

  ctx.beginPath();
  ctx.moveTo(STATE.lastX, STATE.lastY);

  applyToolSettings(getToolSettings());

  // Draw a dot on single click
  ctx.beginPath();
  ctx.arc(STATE.lastX, STATE.lastY, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = getToolSettings().globalAlpha;
  ctx.fill();
  ctx.globalCompositeOperation = getToolSettings().globalCompositeOperation;

  e.preventDefault();
}

function onPointerMove(e) {
  if (!STATE.isDrawing || !STATE.drawingActive) return;

  applyToolSettings(getToolSettings());

  ctx.beginPath();
  ctx.moveTo(STATE.lastX, STATE.lastY);
  ctx.lineTo(e.clientX, e.clientY);
  ctx.stroke();

  STATE.lastX = e.clientX;
  STATE.lastY = e.clientY;

  e.preventDefault();
}

function onPointerUp(e) {
  if (!STATE.isDrawing) return;
  STATE.isDrawing = false;
  ctx.beginPath(); // reset path
}

/* ════════════════════════════════════════════════════════════
   Explanation Panel
   ════════════════════════════════════════════════════════════ */
let panel = null;

function createPanel() {
  if (panel) {
    panel.classList.toggle('sketchmind-panel--open');
    return;
  }

  panel = document.createElement('aside');
  panel.id = 'sketchmind-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'SketchMind AI Explanation Panel');
  panel.classList.add('sketchmind-panel', 'sketchmind-panel--open');

  panel.innerHTML = `
    <div class="sm-panel-header">
      <span class="sm-panel-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        SketchMind AI
      </span>
      <button class="sm-panel-close" id="smPanelClose" aria-label="Close panel">✕</button>
    </div>
    <div class="sm-panel-body">
      <p class="sm-panel-hint">
        Draw on the page, then press <strong>Explain</strong> to get an AI-powered explanation of your sketch.
      </p>
      <button class="sm-btn-explain" id="smExplainBtn" disabled>
        ✨ Explain Sketch
        <span class="sm-coming-soon">— coming soon</span>
      </button>
      <div class="sm-panel-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor" opacity="0.15"/>
          <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor" opacity="0.08"/>
        </svg>
        <p>Explanations will appear here once AI is connected in a future milestone.</p>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById('smPanelClose').addEventListener('click', () => {
    panel.classList.remove('sketchmind-panel--open');
  });
}

/* ════════════════════════════════════════════════════════════
   Message listener (from popup.js)
   ════════════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case 'SKETCHMIND_TOGGLE_DRAW': {
      STATE.drawingActive = message.active;
      STATE.tool          = message.tool  || STATE.tool;
      STATE.color         = message.color || STATE.color;

      if (STATE.drawingActive) {
        enableCanvas();
      } else {
        disableCanvas();
      }

      sendResponse({ ok: true, drawingActive: STATE.drawingActive });
      break;
    }

    case 'SKETCHMIND_OPEN_PANEL': {
      createPanel();
      sendResponse({ ok: true });
      break;
    }

    case 'SKETCHMIND_SET_TOOL': {
      STATE.tool  = message.tool  || STATE.tool;
      STATE.color = message.color || STATE.color;
      sendResponse({ ok: true });
      break;
    }

    case 'SKETCHMIND_CLEAR': {
      clearCanvas();
      sendResponse({ ok: true });
      break;
    }

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
  }

  // Return true to keep the message channel open for async responses
  return true;
});

/* ════════════════════════════════════════════════════════════
   Init: pre-create the canvas (inactive) so it's ready
   ════════════════════════════════════════════════════════════ */
(function init() {
  // Only inject once per page
  if (document.getElementById('sketchmind-canvas')) return;
  createCanvas();
  disableCanvas();
})();
