# Checkpoint

The ultimate local-first developer productivity desktop suite. Designed for solo developers context-switching between primary work and heavy side projects. It is a lightweight, zero-cloud alternative to the core utility overlap of Slack (activity logs/scratchpad), Trello (Kanban board), and Jira (structured backlog).

---

## Features

- **Chronological Scratchpad (Log View)**: A quick Slack-like feed for tracking daily context, notes, and milestones. Supports Markdown, custom tags, pinning, and promotion directly to Kanban cards.
- **Visual Task Board (Kanban View)**: Trello-style workflow columns with custom WIP limits, swimlanes, and fluid drag-and-drop operations.
- **Structured Registry (Backlog View)**: Jira-style tabular backlog management with grouping, advanced column sorting, multi-select bulk operations, and Markdown exports.
- **AI Assistant & Cookbook**: Discover, evaluate, install, and stream local LLMs via Ollama. Auto-profiles workstation hardware specs to recommend the optimal fit. Supports streaming via any OpenAI-compatible custom endpoint.
- **Hot-Reload Customization**: Custom themes and JS plugins watched and hot-reloaded dynamically from the file system.
- **Windows Desktop Widget**: Frameless, transparent, always-on-top desktop overlay showing daily summaries without stealing keyboard focus.
- **Local Webhook Gateway**: Node-native HTTP socket gateway allowing external IDE scripts and post-build events to append logs and tasks.
- **Passive Activity Focus Tracker**: Local tracking loop monitoring active focus durations across desktop processes.
- **Zero-Config Backup Vaulting**: Auto-vacuums database states to historical checkpoints.

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Ollama](https://ollama.com/) (Optional: for local LLM support)

### Installation
Clone the repository and install dependencies:
```bash
npm install
```

### Run Dev Server
Launch the application in development mode:
```bash
npm run dev
```

### Build & Package Distribution
Compile production assets and build the platform-specific installer package:
```bash
# Compile code
npm run build

# Package distribution build (e.g. NSIS on Windows)
npm run package
```

---

## Configuration & Customization Guides

### 1. Custom AI Endpoint
By default, the AI assistant will look for an Ollama server running locally on `http://127.0.0.1:11434`. 
To configure a cloud service (e.g., OpenAI, Anthropic, or custom endpoints):
1. Navigate to **Settings** -> **AI** tab.
2. Enter your custom **Base URL** (e.g. `https://api.openai.com/v1`) and **API Key**.
3. Select your model parameters and click **Test Connection** to verify settings.

### 2. Custom Theming
You can personalize the aesthetic of Checkpoint without restarting the application:
1. Create a `theme.css` file.
2. Place the file inside your home configuration directory:
   - **Windows**: `C:\Users\<username>\.config\checkpoint\theme.css`
   - **macOS/Linux**: `~/.config/checkpoint/theme.css`
3. Any changes saved to `theme.css` will instantly inject CSS variable overrides (e.g. `--color-primary`, `--color-secondary`) into the running app window.

### 3. JavaScript Plugins
Checkpoint supports custom JS plugins loaded dynamically:
1. Create a `.js` plugin script.
2. Drop the script into the `plugins/` directory:
   - **Windows**: `C:\Users\<username>\.config\checkpoint\plugins\my-plugin.js`
   - **macOS/Linux**: `~/.config/checkpoint/plugins/my-plugin.js`
3. The main process will safely watch and load the plugin on start.

### 4. Windows Desktop Widget
Toggle the widget via **Settings** -> **Widget** section (Windows only).
- **Positioning**: Select corner anchors (Top-Left, Top-Right, etc.).
- **Opacity**: Use the slider to control the opacity.
- **Focus Safety**: The widget window utilizes Electron's `focusable: false` flag, ensuring clicking it never steals focus from your IDE or Unity Editor.

### 5. Webhook Gateway
The gateway spins up a local Node-native HTTP server (default port: `9988`).
- **Endpoint**: `POST http://localhost:9988/api/v1/log`
- **cURL Example**:
  ```bash
  curl -X POST http://localhost:9988/api/v1/log \
    -H "Content-Type: application/json" \
    -d '{
      "context": "unity-project",
      "title": "Automated Build Success",
      "body": "Unity build completed in 2m 14s. Ready for testing.",
      "priority": 1
    }'
  ```

### 6. Quick HUD (Spotlight Search)
Activate the quick hud using the global hotkey shortcut **Ctrl + Shift + Space** (Windows). This brings up a fast input command panel to query logs, view tasks, and capture notes instantly from anywhere on your workstation.

---

## Tech Stack & Architecture

- **Runtime**: Electron v30+
- **Bundler**: electron-vite
- **Frontend**: React v18, Tailwind CSS, Zustand, Lucide Icons, react-markdown
- **Database**: SQLite (via `better-sqlite3` native modules compiled with `electron-rebuild`)
- **IPC Safety**: Zod validated type bounds
- **Packaging**: electron-builder (ASAR enabled, C++ module unpacking)
