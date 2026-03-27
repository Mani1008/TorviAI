# AI Assistant

A privacy-first, lightweight AI assistant desktop application built with **Tauri** (Rust) + **React** (TypeScript).

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS 4, Shadcn UI
- **Backend**: Tauri 2, Rust, SQLite
- **AI**: 6+ built-in providers (OpenAI, Claude, Gemini, Groq, Mistral, Ollama) + custom via curl
- **STT**: 3+ built-in speech-to-text providers + custom
- **Audio**: Platform-specific capture (WASAPI / PulseAudio)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.70+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Install Dependencies

```bash
npm install
```

### Development

```bash
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Project Structure

```
src/                    # Frontend (React/TypeScript)
├── main.tsx            # Entry point
├── routes/             # React Router routes
├── pages/              # Page components (9 pages)
├── components/         # Reusable UI components
├── contexts/           # Global state (AppContext, ThemeContext)
├── hooks/              # Custom React hooks
├── lib/                # Business logic, DB, storage
├── config/             # Provider definitions, constants
├── types/              # TypeScript interfaces
└── layouts/            # Layout wrappers

src-tauri/              # Backend (Rust/Tauri)
├── src/
│   ├── main.rs         # Entry point
│   ├── lib.rs          # Tauri setup + plugin registration
│   ├── api.rs          # AI streaming, STT, license
│   ├── capture.rs      # Screenshot (multi-monitor)
│   ├── shortcuts.rs    # Global keyboard shortcuts
│   └── window.rs       # Window management
└── migrations/         # SQLite schema files
```

## Features

- [x] Project scaffolding & routing
- [x] State management (AppContext + ThemeContext)
- [x] AI provider system (6 built-in + custom curl)
- [x] STT provider system (3 built-in + custom)
- [x] SQLite schema (conversations, messages, system prompts)
- [x] Storage layer (localStorage with safe wrappers)
- [x] Component library (Sidebar, Header, Markdown, TextInput, Empty)
- [x] Tauri backend skeleton (API, capture, shortcuts, window)
- [ ] AI response streaming engine
- [ ] Speech-to-text engine
- [ ] Screenshot capture (xcap)
- [ ] System audio capture (WASAPI/PulseAudio)
- [ ] Global shortcuts registration
- [ ] License activation system
- [ ] Auto-update system
- [ ] Full Shadcn UI primitives

## Architecture

See the `ARCHITECTURE.md` in the pluely-master folder for the full architecture reference this project is based on.
