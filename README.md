# SketchMind AI — Chrome Extension

> Draw on any webpage. Understand it with AI.

**SketchMind AI** is a lightweight Manifest V3 Chrome extension that lets you sketch freehand annotations directly on any webpage and (in future milestones) get AI-powered explanations of your drawings.

---

## ✨ Features

### ✅ Implemented — Milestone 1
| Feature | Status |
|---|---|
| Freehand drawing canvas overlay (full-page) | ✅ |
| Pen, Eraser, Highlighter tools | ✅ |
| 6-color stroke palette | ✅ |
| Clear-all button | ✅ |
| Explanation panel sidebar (UI shell) | ✅ |
| Persistent tool/color state via `chrome.storage.local` | ✅ |
| Works on all `http`/`https` pages | ✅ |
| Clean dark popup UI | ✅ |

### 🗓 Planned — Future Milestones
| Feature | Milestone |
|---|---|
| AI sketch explanation via Gemini / OpenAI API | M2 |
| Screenshot-to-explanation (canvas → image → API) | M2 |
| Lasso / selection tool | M3 |
| Text annotation labels | M3 |
| Save drawings as PNG / SVG | M3 |
| Share annotated page as image | M4 |
| Sidebar history of past explanations | M4 |

---

## 🚀 Installation (Developer Mode)

Chrome extensions under active development are loaded unpacked.

1. **Clone or download** this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the root folder of this repository (the one containing `manifest.json`).
6. The **SketchMind AI** icon will appear in your toolbar. Pin it for easy access.

### Reloading after changes
After editing any file, go to `chrome://extensions` and click the **↺ reload** button next to SketchMind AI, then refresh the tab you're testing on.

---

## 📁 Project Structure

```
SketchMind/
├── manifest.json          # Extension manifest (MV3)
├── popup.html             # Toolbar popup UI
├── popup.js               # Popup interaction logic
├── styles.css             # Popup styles
├── content.js             # Content script — canvas & panel
├── content-styles.css     # Styles injected into host pages
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md
├── .gitignore
└── LICENSE
```

---

## 🛠 Tech Stack

| Layer | Choice |
|---|---|
| Extension API | Chrome Extensions — Manifest V3 |
| UI | Vanilla HTML + CSS |
| Logic | Vanilla JavaScript (ES2020, no bundler) |
| Drawing | Canvas 2D API |
| Storage | `chrome.storage.local` |
| Backend | None (Milestone 1) |

---

## 🔐 Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Read the active tab's ID to send messages to the content script |
| `storage` | Persist selected tool, color, and drawing-mode state across popup sessions |

No `<all_urls>` host permission is requested. Content scripts are declared in the manifest and only activate on pages you visit normally.

---

## 📜 License

MIT — see [LICENSE](LICENSE).
