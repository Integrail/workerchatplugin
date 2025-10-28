# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Development Commands

- **Build for production**: `npm run build`
- **Development mode with watch**: `npm run dev`
- **Run tests**: `npm test`
- **Start test server**: `npm run serve`

## Architecture Overview

This is a TypeScript-based JavaScript plugin that provides voice and text chat capabilities powered by Everworker AI agents. The plugin is distributed as multiple build targets (ESM, UMD, CommonJS) via Rollup.

### Core Architecture Components

**Main Plugin Class**: `src/core/EverworkerVoicePlugin.ts`
- Central orchestrator managing connection adapters, UI, WebRTC, and storage
- Implements session-based communication with 15-minute timeout
- Handles state management and event coordination between all subsystems

**Connection Layer**: Dual adapter pattern
- `DDPAdapter.ts` - DDP WebSocket connection for real-time communication
- `RESTAdapter.ts` - HTTP fallback for basic text messaging
- Connection type auto-detected based on endpoint URL (ws/wss vs http/https)

**Voice System**: `src/voice/WebRTCManager.ts`
- Integrates with OpenAI Realtime API via WebRTC
- Manages ephemeral token exchange with Everworker backend
- Handles bidirectional audio streaming and transcription events
- Coordinates with data channel for text messaging in voice sessions

**UI System**: Modular components in `src/ui/`
- `UIManager.ts` - Coordinates all UI components
- `FloatingButton.ts` - Expandable chat button interface
- `ChatInterface.ts` - Message display and input handling
- Responsive design with customizable positioning and theming

**Event System**: `src/core/EventEmitter.ts`
- Custom event emitter enabling loose coupling between components
- Used throughout for real-time coordination (transcription, audio, messages)

**Storage**: `src/core/StorageManager.ts`
- Handles message persistence (none/session/localStorage)
- Enforces 100-message history limit

### Key Integration Points

**Session Management**: The plugin requires explicit session start/end rather than auto-connecting. Sessions auto-timeout after 15 minutes with 1-minute warning.

**Communication Flow**:
- Voice sessions use WebRTC data channel for text + audio streaming
- Non-voice sessions fall back to connection adapter (DDP/REST)
- Both paths converge in the main plugin's message handling

**Build System**: Rollup generates 4 output formats:
- `dist/everworker-voice.esm.js` - ES modules
- `dist/everworker-voice.umd.js` - Universal module definition
- `dist/everworker-voice.min.js` - Minified UMD for CDN
- `dist/everworker-voice.cjs.js` - CommonJS

### TypeScript Configuration

The project targets ES2018 with DOM APIs and strict type checking enabled. Type definitions are automatically generated during build to `dist/index.d.ts`.