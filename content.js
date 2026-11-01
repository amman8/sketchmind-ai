/**
 * content.js — SketchMind AI  (Milestone 2)
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Modules (all in this single file, separated by sections)   │
 * │  1. STATE          — single source of truth                 │
 * │  2. CANVAS         — creation, HiDPI sizing, resize/scroll  │
 * │  3. DRAWING        — pointer handlers, smooth Bézier curves │
 * │  4. CURSOR         — SVG cursor preview ring                │
 * │  5. TOOLBAR        — floating on-page toolbar               │
 * │  6. PANEL          — explanation sidebar (shell)            │
 * │  7. MESSAGES       — chrome.runtime.onMessage handler       │
 * │  8. INIT           — bootstrap on document_idle            │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Design rules
 *  - Zero external dependencies.
 *  - All DOM ids/classes prefixed "sketchmind-" or "sm-".
 *  - Canvas uses devicePixelRatio so strokes are crisp on HiDPI.
 *  - pointer-events:none when drawing mode is off → page works normally.
 *  - Coordinates always compensate for window scroll.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   §1  STATE
   ═══════════════════════════════════════════════════════════════ */

const STATE = {
  // drawing mode
  active:    false,   // is drawing mode on?
  tool:      'pen',   // 'pen' | 'eraser' | 'highlight'
  color:     '#ef4444',
  lineWidth: 4,       // pen stroke width (1–32 px, logical)

  // stroke-in-progress
  painting:  false,
  points:    [],      // [{x, y}] collected this stroke (for Bézier smoothing)
};

/* ═══════════════════════════════════════════════════════════════
   §2  CANVAS
   ═══════════════════════════════════════════════════════════════ */

/** @type {HTMLCanvasElement|null} */
let canvas = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx    = null;

/**
 * Convert a logical CSS pixel value to the physical canvas pixel,
 * accounting for devicePixelRatio.
 */
function toPhysical(v) {
  return v * window.devicePixelRatio;
}

/**
 * Save the current canvas bitmap, resize to match viewport + DPR,
 * restore the bitmap, re-apply ctx defaults.
 *
 * Called on creation and whenever the window resizes.
 */
function resizeCanvas() {
  if (!canvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w   = window.innerWidth;
  const h   = window.innerHeight;

  // Capture current drawing
  let snapshot = null;
  if (canvas.width > 0 && canvas.height > 0) {
    try { snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (_) {}
  }

  // Physical pixel dimensions
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  // CSS dimensions — always exactly the viewport
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';

  // Scale the context so every draw call uses logical px
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Restore drawing (will be scaled/cropped on big resize — acceptable for M2)
  if (snapshot) {
    // We need to paint onto physical pixels directly, so reset transform temporarily
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(snapshot, 0, 0);
    ctx.restore();
  }

  applyCtxDefaults();
}

/** Set stable ctx properties that survive a resize reset. */
function applyCtxDefaults() {
  if (!ctx) return;
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
}

function createCanvas() {
  if (canvas) return;

  canvas = document.createElement('canvas');
  canvas.id = 'sketchmind-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');

  document.documentElement.appendChild(canvas); // append to <html>, not <body>
  ctx = canvas.getContext('2d');

  resizeCanvas();

  // Pointer events for drawing
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup',   onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // Resize observer — more reliable than window resize for content changes
  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(document.documentElement);

  // Also listen to window resize for viewport changes
  window.addEventListener('resize', resizeCanvas, { passive: true });
}

function enableCanvas() {
  if (!canvas) createCanvas();
  canvas.style.pointerEvents = 'all';
  updateCursor();
}

function disableCanvas() {
  if (!canvas) return;
  canvas.style.pointerEvents = 'none';
  hideCursorDot();
}

function clearCanvas() {
  if (!ctx || !canvas) return;
  // Clear in logical space (transform already applied)
  ctx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
}

/* ═══════════════════════════════════════════════════════════════
   §3  DRAWING  — pointer handlers + smooth Bézier rendering
   ═══════════════════════════════════════════════════════════════ */

/**
 * Convert a PointerEvent's viewport coords to canvas logical coords.
 * The canvas is fixed-positioned so clientX/Y maps directly (no scroll offset needed).
 */
function eventToCanvas(e) {
  return { x: e.clientX, y: e.clientY };
}

/** Build the ctx settings for the current tool. */
function getCtxSettings() {
  const { tool, color, lineWidth } = STATE;

  if (tool === 'eraser') {
    return {
      strokeStyle: '#000000',
      lineWidth:   Math.max(lineWidth * 4, 16),   // eraser is always wider
      globalCompositeOperation: 'destination-out',
      globalAlpha: 1,
    };
  }

  if (tool === 'highlight') {
    return {
      strokeStyle: color,
      lineWidth:   Math.max(lineWidth * 5, 18),
      globalCompositeOperation: 'source-over',
      globalAlpha: 0.30,
    };
  }

  // pen
  return {
    strokeStyle: color,
    lineWidth,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  };
}

function applyCtxSettings(settings) {
  Object.assign(ctx, settings);
}

function onPointerDown(e) {
  if (!STATE.active) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return; // left-click only for mouse

  STATE.painting = true;
  STATE.points   = [];

  canvas.setPointerCapture(e.pointerId);

  const pt = eventToCanvas(e);
  STATE.points.push(pt);

  // Draw a dot immediately so single taps register
  const settings = getCtxSettings();
  applyCtxSettings(settings);
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, settings.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle   = settings.strokeStyle;
  ctx.globalAlpha = settings.globalAlpha;
  ctx.globalCompositeOperation = settings.globalCompositeOperation;
  ctx.fill();

  e.preventDefault();
}

function onPointerMove(e) {
  const pt = eventToCanvas(e);

  // Always update cursor dot position
  moveCursorDot(pt.x, pt.y);

  if (!STATE.painting || !STATE.active) return;

  STATE.points.push(pt);
  renderStroke();

  e.preventDefault();
}

function onPointerUp() {
  if (!STATE.painting) return;
  STATE.painting = false;

  // Final render pass with all collected points
  if (STATE.points.length > 1) renderStroke();
  STATE.points = [];
}

/**
 * Render a smooth quadratic Bézier curve through STATE.points.
 * Re-draws only the last segment for performance.
 */
function renderStroke() {
  const pts = STATE.points;
  if (pts.length < 2) return;

  const settings = getCtxSettings();
  applyCtxSettings(settings);

  ctx.beginPath();

  if (pts.length === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    // Smooth through midpoints
    const last = pts.length - 1;
    ctx.moveTo(pts[last - 1].x, pts[last - 1].y);
    const midX = (pts[last - 1].x + pts[last].x) / 2;
    const midY = (pts[last - 1].y + pts[last].y) / 2;
    ctx.quadraticCurveTo(pts[last - 1].x, pts[last - 1].y, midX, midY);
    ctx.lineTo(pts[last].x, pts[last].y);
  }

  ctx.stroke();
}

/* ═══════════════════════════════════════════════════════════════
   §4  CURSOR  — SVG ring that previews stroke size
   ═══════════════════════════════════════════════════════════════ */

/** @type {HTMLElement|null} */
let cursorDot = null;

function createCursorDot() {
  if (cursorDot) return;
  cursorDot = document.createElement('div');
  cursorDot.id = 'sketchmind-cursor';
  cursorDot.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(cursorDot);
}

function moveCursorDot(x, y) {
  if (!STATE.active) return;
  if (!cursorDot) createCursorDot();

  const settings = getCtxSettings();
  const r = Math.max(4, settings.lineWidth / 2);
  const d = r * 2;

  cursorDot.style.display    = 'block';
  cursorDot.style.width      = d + 'px';
  cursorDot.style.height     = d + 'px';
  cursorDot.style.left       = (x - r) + 'px';
  cursorDot.style.top        = (y - r) + 'px';
  cursorDot.style.borderRadius = '50%';

  // Color the ring to match current tool
  if (STATE.tool === 'eraser') {
    cursorDot.style.borderColor = 'rgba(255,255,255,0.7)';
    cursorDot.style.background  = 'rgba(255,255,255,0.08)';
  } else {
    cursorDot.style.borderColor = STATE.color;
    cursorDot.style.background  = STATE.color + '22';
  }
}

function hideCursorDot() {
  if (cursorDot) cursorDot.style.display = 'none';
}

function updateCursor() {
  // Hide OS cursor on canvas — our custom dot takes over
  if (!canvas) return;
  canvas.style.cursor = 'none';
}

/* ═══════════════════════════════════════════════════════════════
   §5  TOOLBAR  — floating on-page control bar
   ═══════════════════════════════════════════════════════════════ */

/** @type {HTMLElement|null} */
let toolbar = null;

const TOOLBAR_COLORS = [
  { hex: '#ef4444', label: 'Red'    },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#eab308', label: 'Yellow' },
  { hex: '#22c55e', label: 'Green'  },
  { hex: '#3b82f6', label: 'Blue'   },
  { hex: '#a855f7', label: 'Purple' },
  { hex: '#ffffff', label: 'White'  },
  { hex: '#1e293b', label: 'Dark'   },
];

function createToolbar() {
  if (toolbar) return;

  toolbar = document.createElement('div');
  toolbar.id = 'sketchmind-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'SketchMind drawing tools');

  toolbar.innerHTML = `
    <div class="sm-tb-section sm-tb-brand">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/>
        <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor" opacity="0.6"/>
      </svg>
      <span>SketchMind</span>
    </div>

    <div class="sm-tb-sep"></div>

    <div class="sm-tb-section sm-tb-tools">
      <button class="sm-tb-btn sm-tb-tool active" data-tool="pen" title="Pen (P)" aria-label="Pen tool" aria-pressed="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/>
          <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor" opacity="0.6"/>
        </svg>
      </button>
      <button class="sm-tb-btn sm-tb-tool" data-tool="highlight" title="Highlighter (H)" aria-label="Highlighter tool" aria-pressed="false">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="13" width="18" height="6" rx="1" fill="currentColor" opacity="0.45"/>
          <path d="M8 13V6l4-2 4 2v7" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      </button>
      <button class="sm-tb-btn sm-tb-tool" data-tool="eraser" title="Eraser (E)" aria-label="Eraser tool" aria-pressed="false">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 20H7L3 16l10-10 7 7-3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="sm-tb-sep"></div>

    <div class="sm-tb-section sm-tb-colors" aria-label="Stroke color">
      ${TOOLBAR_COLORS.map(c => `
        <button class="sm-tb-color ${c.hex === STATE.color ? 'active' : ''}"
          data-color="${c.hex}"
          style="background:${c.hex}"
          title="${c.label}"
          aria-label="${c.label}"
          aria-pressed="${c.hex === STATE.color}">
        </button>`).join('')}
    </div>

    <div class="sm-tb-sep"></div>

    <div class="sm-tb-section sm-tb-width" title="Pen width">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="opacity:.55">
        <circle cx="12" cy="12" r="4"/>
      </svg>
      <input type="range"
        id="sm-tb-width-slider"
        class="sm-tb-slider"
        min="1" max="32"
        value="${STATE.lineWidth}"
        aria-label="Pen width"
        step="1" />
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="opacity:.55">
        <circle cx="12" cy="12" r="8"/>
      </svg>
    </div>

    <div class="sm-tb-sep"></div>

    <div class="sm-tb-section">
      <button class="sm-tb-btn" id="sm-tb-clear" title="Clear canvas (Del)" aria-label="Clear all drawings">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="sm-tb-sep"></div>

    <div class="sm-tb-section">
      <button class="sm-tb-btn sm-tb-exit" id="sm-tb-exit" title="Exit drawing mode (Esc)" aria-label="Exit drawing mode">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Exit</span>
      </button>
    </div>
  `;

  document.documentElement.appendChild(toolbar);
  bindToolbarEvents();
}

function showToolbar() {
  if (!toolbar) createToolbar();
  toolbar.classList.add('sm-tb--visible');
  syncToolbarState();
}

function hideToolbar() {
  if (toolbar) toolbar.classList.remove('sm-tb--visible');
}

/** Sync toolbar button states to match current STATE. */
function syncToolbarState() {
  if (!toolbar) return;

  // Tool buttons
  toolbar.querySelectorAll('.sm-tb-tool').forEach(btn => {
    const active = btn.dataset.tool === STATE.tool;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // Color buttons
  toolbar.querySelectorAll('.sm-tb-color').forEach(btn => {
    const active = btn.dataset.color === STATE.color;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // Width slider
  const slider = toolbar.querySelector('#sm-tb-width-slider');
  if (slider) slider.value = STATE.lineWidth;
}

function bindToolbarEvents() {
  // Tool selection
  toolbar.querySelectorAll('.sm-tb-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.tool = btn.dataset.tool;
      syncToolbarState();
      updateCursor();
      // Notify popup about tool change (best-effort)
      chrome.runtime.sendMessage({ type: 'SKETCHMIND_TOOL_CHANGED', tool: STATE.tool }).catch(() => {});
    });
  });

  // Color selection
  toolbar.querySelectorAll('.sm-tb-color').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.color = btn.dataset.color;
      // Switch back to pen if on eraser
      if (STATE.tool === 'eraser') STATE.tool = 'pen';
      syncToolbarState();
      updateCursor();
      chrome.runtime.sendMessage({ type: 'SKETCHMIND_COLOR_CHANGED', color: STATE.color }).catch(() => {});
    });
  });

  // Width slider
  const slider = toolbar.querySelector('#sm-tb-width-slider');
  if (slider) {
    slider.addEventListener('input', () => {
      STATE.lineWidth = Number(slider.value);
      chrome.runtime.sendMessage({ type: 'SKETCHMIND_WIDTH_CHANGED', lineWidth: STATE.lineWidth }).catch(() => {});
    });
    // Prevent slider drag from drawing on canvas
    slider.addEventListener('pointerdown', e => e.stopPropagation());
  }

  // Clear
  toolbar.querySelector('#sm-tb-clear').addEventListener('click', () => {
    clearCanvas();
  });

  // Exit drawing mode
  toolbar.querySelector('#sm-tb-exit').addEventListener('click', () => {
    exitDrawingMode();
  });

  // Toolbar should never pass events to the canvas
  toolbar.addEventListener('pointerdown', e => e.stopPropagation());
}

/* ═══════════════════════════════════════════════════════════════
   §6  PANEL  — explanation sidebar (shell, AI in future milestone)
   ═══════════════════════════════════════════════════════════════ */

/** @type {HTMLElement|null} */
let panel = null;

function openPanel() {
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'sketchmind-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'SketchMind AI Explanation Panel');
    panel.className = 'sketchmind-panel';

    panel.innerHTML = `
      <div class="sm-panel-header">
        <span class="sm-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          SketchMind AI
        </span>
        <button class="sm-panel-close" aria-label="Close panel">✕</button>
      </div>
      <div class="sm-panel-body">
        <p class="sm-panel-hint">
          Draw on the page, then press <strong>Explain</strong> to get an AI-powered explanation of your sketch.
        </p>
        <button class="sm-btn-explain" disabled>
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

    document.documentElement.appendChild(panel);

    panel.querySelector('.sm-panel-close').addEventListener('click', () => {
      panel.classList.remove('sketchmind-panel--open');
    });
  }

  // Toggle open/close
  panel.classList.toggle('sketchmind-panel--open');
}

/* ═══════════════════════════════════════════════════════════════
   §7  MODE CONTROL
   ═══════════════════════════════════════════════════════════════ */

function enterDrawingMode(opts = {}) {
  if (opts.tool)      STATE.tool      = opts.tool;
  if (opts.color)     STATE.color     = opts.color;
  if (opts.lineWidth) STATE.lineWidth = opts.lineWidth;

  STATE.active = true;
  enableCanvas();
  showToolbar();
  createCursorDot();
}

function exitDrawingMode() {
  STATE.active   = false;
  STATE.painting = false;

  disableCanvas();
  hideToolbar();
  hideCursorDot();

  // Notify popup so it can update its own UI
  chrome.runtime.sendMessage({ type: 'SKETCHMIND_DRAW_EXITED' }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════
   §8  KEYBOARD SHORTCUTS  (only active in drawing mode)
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('keydown', (e) => {
  if (!STATE.active) return;

  // Don't intercept when focus is in an input/textarea
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;

  switch (e.key) {
    case 'Escape': exitDrawingMode(); break;
    case 'Delete':
    case 'Backspace': clearCanvas(); break;
    case 'p': case 'P': STATE.tool = 'pen';       syncToolbarState(); break;
    case 'e': case 'E': STATE.tool = 'eraser';    syncToolbarState(); break;
    case 'h': case 'H': STATE.tool = 'highlight'; syncToolbarState(); break;
    default: return;
  }

  e.preventDefault();
}, { passive: false });

/* ═══════════════════════════════════════════════════════════════
   §9  MESSAGE HANDLER  (from popup.js via chrome.tabs.sendMessage)
   ═══════════════════════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  switch (msg.type) {

    case 'SKETCHMIND_TOGGLE_DRAW': {
      if (msg.active) {
        enterDrawingMode({ tool: msg.tool, color: msg.color, lineWidth: msg.lineWidth });
      } else {
        exitDrawingMode();
      }
      respond({ ok: true, active: STATE.active });
      break;
    }

    case 'SKETCHMIND_OPEN_PANEL': {
      openPanel();
      respond({ ok: true });
      break;
    }

    case 'SKETCHMIND_SET_TOOL': {
      if (msg.tool)      STATE.tool      = msg.tool;
      if (msg.color)     STATE.color     = msg.color;
      if (msg.lineWidth) STATE.lineWidth = msg.lineWidth;
      syncToolbarState();
      respond({ ok: true });
      break;
    }

    case 'SKETCHMIND_CLEAR': {
      clearCanvas();
      respond({ ok: true });
      break;
    }

    case 'SKETCHMIND_GET_STATE': {
      respond({ ok: true, active: STATE.active, tool: STATE.tool, color: STATE.color, lineWidth: STATE.lineWidth });
      break;
    }

    default:
      respond({ ok: false, error: 'Unknown message type: ' + msg.type });
  }

  return true; // keep channel open for async
});

/* ═══════════════════════════════════════════════════════════════
   §10  INIT
   ═══════════════════════════════════════════════════════════════ */

(function init() {
  // Guard: only inject once (content scripts can run multiple times in some edge cases)
  if (document.getElementById('sketchmind-canvas')) return;

  createCanvas();   // canvas exists but is transparent + non-interactive
  disableCanvas();  // pointer-events: none until user activates
})();
