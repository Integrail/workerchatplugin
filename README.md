# Everworker Voice Plugin

A lightweight, embeddable JavaScript plugin that enables voice and chat capabilities powered by Everworker AI agents on any website.

## Features

- 🎙️ **Real-time Voice Communication** - WebRTC-based voice streaming with OpenAI Realtime API
- 💬 **Dual Voice & Text Chat** - Seamless switching between voice and text input
- 🔌 **Easy Integration** - Simple script tag or npm package installation
- 🎨 **Customizable UI** - Minimal floating button with expandable chat interface
- 🔒 **Secure** - Server-side API key management with ephemeral tokens
- 📱 **Responsive** - Works on desktop and mobile devices
- 🌐 **Multiple Connection Modes** - DDP (real-time) with REST API fallback

## Quick Start

### CDN Installation

```html
<script src="https://cdn.everworker.ai/voice-plugin.min.js"></script>
<script>
  EverworkerVoice.init({
    endpoint: 'wss://your-instance.everworker.ai',
    workerId: 'your-worker-id',
    token: 'your-public-token'
  });
</script>
```

### NPM Installation

```bash
npm install @everworker/voice-plugin
```

```javascript
import { EverworkerVoice } from '@everworker/voice-plugin';

const voice = new EverworkerVoice({
  endpoint: 'wss://your-instance.everworker.ai',
  workerId: 'your-worker-id',
  auth: {
    type: 'token',
    token: 'your-token'
  }
});

await voice.connect();
```

## Configuration Options

```typescript
interface PluginConfig {
  // Required
  endpoint: string;        // Everworker instance URL
  workerId: string;        // Universal Worker ID
  
  // Authentication
  auth?: {
    type: 'token' | 'jwt' | 'anonymous';
    token?: string | (() => Promise<string>);
  };
  
  // UI Customization
  ui?: {
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    theme?: 'light' | 'dark' | 'auto';
    primaryColor?: string;
    container?: HTMLElement;  // Custom container instead of floating button
  };
  
  // Features
  features?: {
    voice?: boolean;       // Enable voice input (default: true)
    text?: boolean;        // Enable text input (default: true)
    persistence?: 'none' | 'session' | 'local';  // Chat history persistence
  };
  
  // Callbacks
  callbacks?: {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onMessage?: (message: Message) => void;
    onError?: (error: Error) => void;
  };
}
```

## API Reference

### Core Methods

```javascript
// Initialize the plugin
EverworkerVoice.init(config);

// Connection management
await voice.connect();
voice.disconnect();

// Send messages
voice.sendMessage('Hello!');

// Voice control
voice.startVoiceInput();
voice.stopVoiceInput();

// UI control
voice.show();
voice.hide();
voice.minimize();
voice.expand();

// Event handling
voice.on('message', (msg) => console.log(msg));
voice.off('message', handler);

// Cleanup
voice.destroy();
```

### Events

- `connect` - Connected to Everworker backend
- `disconnect` - Disconnected from backend
- `message` - New message received
- `error` - Error occurred
- `stateChange` - Connection state changed
- `transcription` - Voice transcription available

## Advanced Usage

### Custom Styling

```javascript
const voice = new EverworkerVoice({
  // ... other config
  ui: {
    theme: 'custom',
    customStyles: `
      .ew-chat-button { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
      .ew-chat-message { font-family: 'Inter', sans-serif; }
    `
  }
});
```

### Multiple Workers

```javascript
// Customer support bot
const supportBot = new EverworkerVoice({
  workerId: 'support-agent',
  ui: { position: 'bottom-right' }
});

// Sales assistant
const salesBot = new EverworkerVoice({
  workerId: 'sales-agent',
  ui: { position: 'bottom-left' }
});
```

### Programmatic Control

```javascript
// Listen for specific keywords
voice.on('transcription', (text) => {
  if (text.includes('help')) {
    voice.sendMessage('I can help you with that!');
  }
});

// Custom authentication flow
const voice = new EverworkerVoice({
  auth: {
    type: 'jwt',
    token: async () => {
      const response = await fetch('/api/get-everworker-token');
      const { token } = await response.json();
      return token;
    }
  }
});
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14.1+
- Edge 90+

Voice features require:
- WebRTC support
- Secure context (HTTPS)
- Microphone permissions

## Development

```bash
# Clone the repository
git clone https://github.com/Integrail/everworker-voice-plugin.git
cd everworker-voice-plugin

# Install dependencies
npm install

# Development mode with watch
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## License

MIT

## Support

For issues and questions:
- GitHub Issues: [everworker-voice-plugin/issues](https://github.com/Integrail/everworker-voice-plugin/issues)
- Documentation: [everworker.ai/docs/voice-plugin](https://everworker.ai/docs/voice-plugin)