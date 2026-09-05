# Checkpoint

The ultimate local-first developer productivity desktop suite. Designed for solo developers context-switching between primary work and heavy side projects. It is a lightweight, zero-cloud alternative to the core utility overlap of Slack (activity logs/scratchpad), Trello (Kanban board), and Jira (structured backlog).

---

## Features

### Core Workspace Views
- **Chronological Scratchpad (Log View)**: A quick, Slack-like chronological feed for tracking daily context, notes, and milestones. Supports Markdown, custom tags, pinning, and promotion directly to Kanban cards.
- **Visual Task Board (Kanban View)**: Trello-style workflow columns with custom WIP limits, swimlanes, subtask checklists, and fluid drag-and-drop operations powered by `@dnd-kit`.
- **Structured Registry (Backlog View)**: Jira-style tabular backlog management with grouping, advanced column sorting, multi-select bulk operations, search, and Markdown exports.
- **Obsidian-like Markdown Notes (Notes View)**: A local markdown note repository stored directly in your home folder. Supports live markdown editing, excerpt previews, tag indexing, global text search, and Wiki-link style links.

### AI Assistant & Custom LLMs
- **AI Assistant & Cookbook**: Discover, evaluate, install, and stream local LLMs via Ollama. It profiles workstation hardware (CPU/RAM/GPU) to recommend the optimal fit. Supports streaming via any OpenAI-compatible custom endpoint (e.g., OpenAI, Anthropic). Toggled via `Ctrl + L`.
- **AI Memory System**: Persistent local semantic, episodic, and working memory contexts stored in SQLite, allowing the local AI assistant to retain long-term contextual memory between application restarts.
- **Workspace Codebase Indexing**: Select and index a local project directory. The AI assistant can load, search, and analyze codebase file structures and contents to assist with coding tasks.
- **Standup Translator (AI Summarizer)**: Integrated directly inside the Log and Backlog views. Automatically parses technical daily developer logs and converts them into professional, structured Agile-ready updates (Achievements, In Progress, Impediments) customized by style (Professional Corporate, Agile Bullet Points, or Executive).

### Productivity & Automation
- **Clipboard History & Snippets (Clipboard View)**: Passive history tracker capturing the last 200 text copies. Quickly star/pin items as reusable code Snippets. Access the manager via global hotkey `Ctrl + Shift + V` to paste history instantly back into your workflow.
- **Local Cheatsheets Hub (Cheatsheets View)**: Discover, import, search, and view local PDF/text cheatsheets. Files are served securely via a custom Electron protocol (`cheatsheet://`) with semantic keyword query highlighting.
- **Quick HUD (Spotlight Search)**: Centered Spotlight-style quick capture search overlay triggered via `Ctrl + Shift + Space`. Allows developers to log notes, tasks, or bugs mid-workflow using natural language parameters (`#tag`, `@context`, `!priority`).
- **Passive Focus Tracker & Analytics**: Offline background focus tracker that monitors active processes and window titles (consuming <0.1% CPU) to log focus durations. Displays a rich Analytics View showing weekly task completions, a contribution heatmap calendar, tag distributions, and active/passive time breakdowns.
- **Windows Desktop Widget**: Frameless, transparent, always-on-top corner widget showing daily summaries without stealing keyboard focus (`focusable: false`).
- **Local Webhook Gateway**: Node-native HTTP socket gateway (default port `9988`) allowing external IDE post-build scripts, Git hooks, and automation to write tasks and logs programmatically via cURL.

### System & Customization
- **Hot-Reload Customization & Extensions**: Modify CSS variables dynamically in a live Theme Customizer. Scan and hot-load/unload sandboxed JavaScript plugins from the local plugins folder on the fly.
- **Zero-Config Backup Vaulting**: Online backup scheduler that creates transactionally consistent SQLite copies without locking DB activity. Compresses backups into rolling gzip archives (retaining the last 10 snapshots) with diagnostic verification and restoration support.

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

### 1. Custom AI Endpoint & Workspace
By default, the AI assistant will look for an Ollama server running locally on `http://127.0.0.1:11434`.
To configure a cloud service (e.g., OpenAI, Anthropic, or custom endpoints):
1. Navigate to **Settings** -> **AI** tab.
2. Enter your custom **Base URL** (e.g., `https://api.openai.com/v1`) and **API Key**.
3. Select your model parameters and click **Test Connection** to verify settings.
4. Set a **Workspace Path** under Settings to index and query your active project files.

### 2. Custom Theming
You can personalize the aesthetic of Checkpoint dynamically:
1. Open **Settings** -> **Appearance** -> **Theme Customizer** to adjust variables via color pickers.
2. Alternatively, create/edit a `theme.css` file directly in your configuration folder:
   - **Windows**: `C:\Users\<username>\.config\checkpoint\theme.css`
   - **macOS/Linux**: `~/.config/checkpoint/theme.css`
3. Any changes saved to `theme.css` are instantly hot-reloaded and injected into the running window.

### 3. JavaScript Plugins
Checkpoint supports custom JS plugins loaded dynamically:
1. Create a `.js` plugin script.
2. Place the script into the `plugins/` directory:
   - **Windows**: `C:\Users\<username>\.config\checkpoint\plugins\my-plugin.js`
   - **macOS/Linux**: `~/.config/checkpoint/plugins/my-plugin.js`
3. The customizer will watch this folder, load plugins sandboxed, and dynamically execute/unregister their hooks.

### 4. Windows Desktop Widget
Toggle the widget via **Settings** -> **Widget** section (Windows only).
- **Positioning**: Select corner anchors (Top-Left, Top-Right, etc.).
- **Opacity**: Use the slider to control overlay opacity.
- **Focus Safety**: Utilizing Electron's `focusable: false` flag, clicking it never steals focus from your IDE, Unity Editor, or active window.

### 5. Webhook Gateway
The gateway spins up a local Node-native HTTP server (default port: `9988`, auto-increments if port is in use).

**Every request needs a token.** Find it under **Settings → Features → Local
Webhook Gateway**, where it can be copied. It is generated once and kept.

The token is not optional and not decoration. The gateway listens on the
loopback interface, and loopback is reachable from any page in any browser the
user has open, so without a secret any website could write rows into the
database. Requests without a valid token get `401`.

- **Endpoints**:
  - `POST http://localhost:9988/api/v1/log` (inserts scratchpad entry)
  - `POST http://localhost:9988/api/v1/task` (inserts task backlog card)
- **cURL Example**:
  ```bash
  curl -X POST http://localhost:9988/api/v1/log \
    -H "Authorization: Bearer <your-token>" \
    -H "Content-Type: application/json" \
    -d '{
      "context": "unity-project",
      "title": "Automated Build Success",
      "body": "Unity build completed in 2m 14s. Ready for testing.",
      "priority": 1
    }'
  ```

The gateway sends no CORS headers, so it cannot be called from a browser page
at all. That is deliberate: the callers this is for are scripts and CI jobs.

### 6. Quick HUD (Spotlight Search)
Activate the quick HUD using the global hotkey shortcut **Ctrl + Shift + Space** (Windows). This brings up a fast input command panel to query logs, view tasks, and capture notes instantly from anywhere on your workstation. Customize your preferred hotkeys under **Settings** -> **Shortcuts**.

### 7. Clipboard Manager & History
Activate the clipboard manager using the global hotkey shortcut **Ctrl + Shift + V**. This displays your local clipboard logs (retaining the last 200 copies) and allows pinning items as permanent snippets. Selecting an item copies it back into the OS active register and auto-hides the panel.

---

## Tech Stack & Architecture

- **Runtime**: Electron v33+
- **Bundler**: electron-vite (wrapping Vite v6)
- **Language**: TypeScript (Strict Mode)
- **Frontend**: React v19, Tailwind CSS v3, Zustand v5, Lucide Icons, react-markdown, remark-gfm
- **Database**: SQLite (via native C++ `better-sqlite3` compiled with `@electron/rebuild`)
- **Graphics & PBR Map Preview**: Three.js
- **IPC Safety**: Zod validated payloads at main/renderer boundary
- **Packaging**: electron-builder (ASAR enabled, C++ module unpacking)

### A note on `dependencies` vs `devDependencies`

Only packages the **main process** loads at runtime belong in `dependencies`:
`@modelcontextprotocol/sdk`, `better-sqlite3`, `chokidar`, `openai`,
`pdf-parse`, `systeminformation`, `uuid` and `zod`.

Everything the renderer uses (React, Three.js, Mermaid, Lucide, dnd-kit, the
fonts) is a **devDependency**, because Vite bundles it into `out/renderer`
during the build. electron-builder packs `dependencies` into the installer as
real `node_modules`, so a renderer library listed there ships a second copy of
itself. Doing that cost 105 MB of installer before it was noticed.

If you add a package, ask which process loads it. To check, build and grep the
output for the import: a package that never appears in `out/main` or
`out/preload` does not belong in `dependencies`.
