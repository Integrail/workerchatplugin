import { 
    PluginConfig, 
    ConnectionState, 
    Message,
    ConnectionAdapter 
} from '../types';
import { EventEmitter } from './EventEmitter';
import { DDPAdapter } from './DDPAdapter';
import { RESTAdapter } from './RESTAdapter';
import { WebRTCManager } from '../voice/WebRTCManager';
import { UIManager } from '../ui/UIManager';
import { StorageManager } from './StorageManager';

export class EverworkerVoicePlugin extends EventEmitter {
    private config: PluginConfig;
    private connection: ConnectionAdapter | null = null;
    private webrtc: WebRTCManager | null = null;
    private ui: UIManager | null = null;
    private storage: StorageManager;
    private state: ConnectionState = 'disconnected';
    private messages: Message[] = [];
    private reconnectAttempts = 0;
    private reconnectTimer: any = null;
    private initialized = false;

    constructor(config: PluginConfig) {
        super();
        this.config = this.validateConfig(config);
        this.storage = new StorageManager(config.features?.persistence || 'none');
        
        if (this.config.features?.autoConnect !== false) {
            this.init();
        }
    }

    private validateConfig(config: PluginConfig): PluginConfig {
        if (!config.endpoint) {
            throw new Error('Endpoint is required');
        }
        if (!config.workerId) {
            throw new Error('Worker ID is required');
        }
        
        // Set defaults
        return {
            ...config,
            auth: config.auth || { type: 'anonymous' },
            ui: {
                position: 'bottom-right',
                theme: 'auto',
                zIndex: 9999,
                buttonSize: 'medium',
                expandedWidth: '380px',
                expandedHeight: '600px',
                ...config.ui
            },
            features: {
                voice: true,
                text: true,
                tools: false,
                persistence: 'session',
                autoConnect: true,
                reconnect: true,
                reconnectInterval: 5000,
                maxReconnectAttempts: 10,
                ...config.features
            },
            callbacks: config.callbacks || {}
        };
    }

    public async init(): Promise<void> {
        if (this.initialized) {
            console.warn('Plugin already initialized');
            return;
        }

        try {
            // Initialize UI
            this.ui = new UIManager(this.config.ui!, {
                onSendMessage: this.sendMessage.bind(this),
                onStartVoice: this.startVoiceInput.bind(this),
                onStopVoice: this.stopVoiceInput.bind(this),
                onToggleExpanded: this.handleToggleExpanded.bind(this)
            });

            // Load persisted messages
            this.messages = await this.storage.loadMessages();
            if (this.messages.length > 0) {
                this.ui.setMessages(this.messages);
            }

            // Initialize connection
            await this.connect();
            
            this.initialized = true;
            this.emit('initialized');
        } catch (error) {
            console.error('Failed to initialize plugin:', error);
            this.setState('error');
            throw error;
        }
    }

    public async connect(): Promise<void> {
        if (this.state === 'connecting' || this.state === 'connected') {
            return;
        }

        this.setState('connecting');

        try {
            // Try DDP first, fallback to REST
            const isDDPEndpoint = this.config.endpoint.startsWith('ws');
            
            if (isDDPEndpoint) {
                this.connection = new DDPAdapter(this.config);
            } else {
                this.connection = new RESTAdapter(this.config);
            }

            // Set up connection event handlers
            this.connection.on('message', this.handleMessage.bind(this));
            this.connection.on('error', this.handleError.bind(this));
            this.connection.on('disconnect', this.handleDisconnect.bind(this));

            await this.connection.connect();
            
            // Initialize WebRTC if voice is enabled
            if (this.config.features?.voice) {
                await this.initializeVoice();
            }

            this.setState('connected');
            this.reconnectAttempts = 0;
            
            if (this.config.callbacks?.onConnect) {
                this.config.callbacks.onConnect();
            }
        } catch (error) {
            console.error('Connection failed:', error);
            this.setState('error');
            this.handleReconnect();
            throw error;
        }
    }

    private async initializeVoice(): Promise<void> {
        try {
            this.webrtc = new WebRTCManager(this.config, this.connection!);
            
            // Handle transcriptions
            this.webrtc.on('transcription', (text: string, isFinal: boolean) => {
                if (this.config.callbacks?.onTranscription) {
                    this.config.callbacks.onTranscription(text, isFinal);
                }
                
                if (this.ui && isFinal) {
                    this.ui.showTranscription(text);
                }
            });

            // Handle audio output
            this.webrtc.on('audio', (audioData: ArrayBuffer) => {
                this.playAudio(audioData);
            });
            
            // Handle messages from WebRTC
            this.webrtc.on('message', (data: any) => {
                this.handleMessage(data);
            });
            
            // Handle text deltas for streaming
            let accumulatedText = '';
            this.webrtc.on('text:delta', (delta: string) => {
                accumulatedText += delta;
                // You could emit partial messages here if needed
            });
            
            // Handle errors
            this.webrtc.on('error', (error: Error) => {
                this.handleError(error);
            });

            await this.webrtc.initialize();
        } catch (error) {
            console.error('Failed to initialize voice:', error);
            // Voice initialization failure shouldn't break text chat
        }
    }

    public disconnect(): void {
        this.clearReconnectTimer();
        
        if (this.webrtc) {
            this.webrtc.cleanup();
            this.webrtc = null;
        }

        if (this.connection) {
            this.connection.disconnect();
            this.connection = null;
        }

        this.setState('disconnected');
        
        if (this.config.callbacks?.onDisconnect) {
            this.config.callbacks.onDisconnect();
        }
    }

    public async sendMessage(text: string): Promise<void> {
        if (this.state !== 'connected') {
            throw new Error('Not connected');
        }

        const message: Message = {
            id: this.generateId(),
            type: 'user',
            content: text,
            timestamp: new Date(),
            source: 'text'
        };

        this.addMessage(message);
        
        try {
            // If voice is enabled and WebRTC is connected, send through WebRTC
            if (this.webrtc) {
                this.webrtc.sendTextMessage(text);
            } else if (this.connection) {
                // Fallback to connection adapter (REST API)
                await this.connection.sendMessage(text);
            } else {
                throw new Error('No communication channel available');
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            // If it's the WebRTC error about using data channel, that's expected for DDP
            if (error instanceof Error && error.message.includes('WebRTC')) {
                // For DDP connections without voice, we can't send text messages
                // This is a limitation of the current architecture
                console.warn('Text messaging requires WebRTC connection. Enable voice feature or use REST API.');
            }
            throw error;
        }
    }

    public async startVoiceInput(): Promise<void> {
        if (!this.webrtc) {
            throw new Error('Voice not initialized');
        }

        await this.webrtc.startRecording();
        this.ui?.setVoiceActive(true);
    }

    public stopVoiceInput(): void {
        if (!this.webrtc) {
            return;
        }

        this.webrtc.stopRecording();
        this.ui?.setVoiceActive(false);
    }

    private handleMessage(data: any): void {
        const message: Message = {
            id: data.id || this.generateId(),
            type: 'assistant',
            content: data.content || data.text || '',
            timestamp: new Date(data.timestamp || Date.now()),
            source: data.source || 'text',
            metadata: data.metadata
        };

        this.addMessage(message);
        
        if (this.config.callbacks?.onMessage) {
            this.config.callbacks.onMessage(message);
        }
    }

    private addMessage(message: Message): void {
        this.messages.push(message);
        this.ui?.addMessage(message);
        this.storage.saveMessages(this.messages);
    }

    private handleError(error: Error): void {
        console.error('Connection error:', error);
        
        if (this.config.callbacks?.onError) {
            this.config.callbacks.onError(error);
        }

        this.ui?.showError(error.message);
    }

    private handleDisconnect(): void {
        this.setState('disconnected');
        this.handleReconnect();
    }

    private handleReconnect(): void {
        if (!this.config.features?.reconnect) {
            return;
        }

        if (this.reconnectAttempts >= (this.config.features?.maxReconnectAttempts || 10)) {
            console.error('Max reconnection attempts reached');
            this.setState('error');
            return;
        }

        this.clearReconnectTimer();
        this.setState('reconnecting');
        
        const delay = Math.min(
            (this.config.features?.reconnectInterval || 5000) * Math.pow(2, this.reconnectAttempts),
            30000
        );

        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempts++;
            this.connect().catch(console.error);
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private setState(state: ConnectionState): void {
        this.state = state;
        this.ui?.setConnectionState(state);
        this.emit('stateChange', state);
        
        if (this.config.callbacks?.onStateChange) {
            this.config.callbacks.onStateChange(state);
        }
    }

    private handleToggleExpanded(expanded: boolean): void {
        this.emit('ui:toggle', expanded);
    }

    private playAudio(audioData: ArrayBuffer): void {
        // Implement audio playback
        // This would use Web Audio API to play the PCM16 audio
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Public UI control methods
    public show(): void {
        this.ui?.show();
    }

    public hide(): void {
        this.ui?.hide();
    }

    public minimize(): void {
        this.ui?.minimize();
    }

    public expand(): void {
        this.ui?.expand();
    }

    public destroy(): void {
        this.disconnect();
        this.ui?.destroy();
        this.removeAllListeners();
        this.initialized = false;
    }

    // Getter methods
    public getState(): ConnectionState {
        return this.state;
    }

    public getMessages(): Message[] {
        return this.messages;
    }

    public clearMessages(): void {
        this.messages = [];
        this.ui?.clearMessages();
        this.storage.clearMessages();
    }
}

// Global singleton for CDN usage
declare global {
    interface Window {
        EverworkerVoice: {
            init: (config: PluginConfig) => EverworkerVoicePlugin;
            instances: Map<string, EverworkerVoicePlugin>;
        };
    }
}

if (typeof window !== 'undefined') {
    window.EverworkerVoice = {
        init: (config: PluginConfig) => {
            const instance = new EverworkerVoicePlugin(config);
            window.EverworkerVoice.instances.set(config.workerId, instance);
            return instance;
        },
        instances: new Map()
    };
}