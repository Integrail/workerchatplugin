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
    private sessionActive = false;
    private sessionStartTime: Date | null = null;
    private sessionTimeoutTimer: any = null;
    private readonly MAX_MESSAGES = 100; // Limit message history

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
                onToggleExpanded: this.handleToggleExpanded.bind(this),
                onStartSession: this.startSession.bind(this),
                onEndSession: this.endSession.bind(this)
            });

            // Load persisted messages
            this.messages = await this.storage.loadMessages();
            if (this.messages.length > 0) {
                this.ui.setMessages(this.messages);
            }

            // Don't auto-connect, wait for user to start session
            this.setState('disconnected');
            
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
            console.log('🎤 Plugin: Initializing voice features...');
            this.webrtc = new WebRTCManager(this.config, this.connection!);
            
            // Handle transcriptions
            this.webrtc.on('transcription', (text: string, isFinal: boolean) => {
                console.log('📢 Plugin: Received transcription:', text, 'Final:', isFinal);
                if (this.config.callbacks?.onTranscription) {
                    this.config.callbacks.onTranscription(text, isFinal);
                }
                
                if (this.ui) {
                    this.ui.showTranscription(text, isFinal);
                }
            });

            // Handle audio output
            this.webrtc.on('audio', (audioData: ArrayBuffer) => {
                console.log('🎵 Plugin: Received audio data, size:', audioData.byteLength);
                this.playAudio(audioData);
            });
            
            // Handle messages from WebRTC
            this.webrtc.on('message', (data: any) => {
                console.log('💬 Plugin: Received message from WebRTC:', data);
                this.handleMessage(data);
            });
            
            // Handle text deltas for streaming
            let accumulatedText = '';
            this.webrtc.on('text:delta', (delta: string) => {
                accumulatedText += delta;
                console.log('✍️ Plugin: Text delta received, accumulated length:', accumulatedText.length);
                if (this.ui) {
                    this.ui.showResponse(delta, true); // Show delta incrementally
                }
            });
            
            // Handle complete responses
            this.webrtc.on('response:complete', (text: string) => {
                console.log('✅ Plugin: Response complete:', text);
                accumulatedText = ''; // Reset accumulator
                if (this.ui) {
                    this.ui.clearResponse();
                }
            });
            
            // Handle speech events
            this.webrtc.on('speech:start', () => {
                console.log('🎤 Plugin: Speech started');
                if (this.ui) {
                    this.ui.setSpeechDetected(true);
                }
            });
            
            this.webrtc.on('speech:end', () => {
                console.log('🔇 Plugin: Speech ended');
                if (this.ui) {
                    this.ui.setSpeechDetected(false);
                }
            });
            
            // Handle recording events
            this.webrtc.on('recording:start', () => {
                console.log('🔴 Plugin: Recording started');
            });
            
            this.webrtc.on('recording:stop', () => {
                console.log('⏹️ Plugin: Recording stopped');
            });
            
            // Handle errors
            this.webrtc.on('error', (error: Error) => {
                console.error('❌ Plugin: WebRTC error:', error);
                this.handleError(error);
            });

            console.log('🔌 Plugin: Starting WebRTC initialization...');
            await this.webrtc.initialize();
            console.log('✅ Plugin: Voice initialization complete!');
        } catch (error) {
            console.error('❌ Plugin: Failed to initialize voice:', error);
            console.error('Error details:', error);
            this.handleError(error instanceof Error ? error : new Error('Voice initialization failed'));
            // Voice initialization failure shouldn't break the connection
            // User can still use the plugin without voice features
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
        console.log('📨 Plugin: Sending message:', text);
        
        if (!this.sessionActive) {
            console.error('❌ Plugin: Cannot send message - no active session');
            throw new Error('Please start a session first');
        }
        
        if (this.state !== 'connected') {
            console.error('❌ Plugin: Cannot send message - not connected. State:', this.state);
            throw new Error('Not connected');
        }

        const message: Message = {
            id: this.generateId(),
            type: 'user',
            content: text,
            timestamp: new Date(),
            source: 'text'
        };

        console.log('📝 Plugin: Adding message to UI');
        this.addMessage(message);
        
        try {
            // If voice is enabled and WebRTC is connected, send through WebRTC
            if (this.webrtc) {
                console.log('🎯 Plugin: Sending through WebRTC');
                this.webrtc.sendTextMessage(text);
            } else if (this.connection) {
                // Fallback to connection adapter (REST API)
                console.log('🎯 Plugin: Sending through connection adapter');
                await this.connection.sendMessage(text);
            } else {
                console.error('❌ Plugin: No communication channel available');
                throw new Error('No communication channel available');
            }
            console.log('✅ Plugin: Message sent successfully');
        } catch (error) {
            console.error('❌ Plugin: Failed to send message:', error);
            // If it's the WebRTC error about using data channel, that's expected for DDP
            if (error instanceof Error && error.message.includes('WebRTC')) {
                // For DDP connections without voice, we can't send text messages
                // This is a limitation of the current architecture
                console.warn('⚠️ Plugin: Text messaging requires WebRTC connection. Enable voice feature or use REST API.');
            }
            throw error;
        }
    }

    public async startSession(clearHistory: boolean = false): Promise<void> {
        console.log('🚀 Plugin: Starting voice session...');
        
        if (this.sessionActive) {
            console.warn('⚠️ Plugin: Session already active');
            return;
        }

        // Optionally clear message history
        if (clearHistory) {
            this.clearMessages();
        }

        try {
            // Connect to server
            await this.connect();
            
            // Mark session as active
            this.sessionActive = true;
            this.sessionStartTime = new Date();
            
            // Update UI
            this.ui?.setSessionActive(true);
            
            // Auto-start microphone
            try {
                console.log('🎤 Plugin: Auto-starting microphone...');
                await this.startVoiceInput();
            } catch (error) {
                console.warn('⚠️ Plugin: Could not auto-start microphone:', error);
                // Don't fail the session if mic can't start
            }
            
            // Set up session timeout (14 minutes warning, 15 minutes disconnect)
            this.setupSessionTimeout();
            
            console.log('✅ Plugin: Voice session started');
            this.emit('session:started');
        } catch (error) {
            console.error('❌ Plugin: Failed to start session:', error);
            this.sessionActive = false;
            throw error;
        }
    }

    public async endSession(): Promise<void> {
        console.log('🛑 Plugin: Ending voice session...');
        
        if (!this.sessionActive) {
            console.warn('⚠️ Plugin: No active session');
            return;
        }

        // Clear timeout timer
        this.clearSessionTimeout();
        
        // First, stop voice input if active
        try {
            console.log('🔇 Plugin: Stopping voice input before disconnect...');
            this.stopVoiceInput();
        } catch (error) {
            console.warn('⚠️ Plugin: Error stopping voice input:', error);
        }
        
        // Disconnect WebRTC and connection
        this.disconnect();
        
        // Mark session as inactive
        this.sessionActive = false;
        this.sessionStartTime = null;
        
        // Update UI
        this.ui?.setSessionActive(false);
        
        console.log('✅ Plugin: Voice session ended');
        this.emit('session:ended');
    }

    private setupSessionTimeout(): void {
        // Clear any existing timer
        this.clearSessionTimeout();
        
        // Warning at 14 minutes
        setTimeout(() => {
            if (this.sessionActive) {
                console.warn('⚠️ Plugin: Session will timeout in 1 minute');
                this.ui?.showError('Session will timeout in 1 minute. Please save your work.');
                this.emit('session:timeout-warning');
            }
        }, 14 * 60 * 1000);
        
        // Auto-disconnect at 15 minutes
        this.sessionTimeoutTimer = setTimeout(() => {
            if (this.sessionActive) {
                console.warn('⏰ Plugin: Session timeout reached, disconnecting...');
                this.ui?.showError('Session timed out after 15 minutes. Please start a new session.');
                this.endSession();
                this.emit('session:timeout');
            }
        }, 15 * 60 * 1000);
    }

    private clearSessionTimeout(): void {
        if (this.sessionTimeoutTimer) {
            clearTimeout(this.sessionTimeoutTimer);
            this.sessionTimeoutTimer = null;
        }
    }

    public isSessionActive(): boolean {
        return this.sessionActive;
    }

    public getSessionDuration(): number | null {
        if (!this.sessionStartTime) return null;
        return Date.now() - this.sessionStartTime.getTime();
    }

    public async startVoiceInput(): Promise<void> {
        console.log('🎤 Plugin: Starting voice input...');
        
        if (!this.sessionActive) {
            console.error('❌ Plugin: No active session');
            throw new Error('Please start a session first');
        }
        
        if (!this.webrtc) {
            console.error('❌ Plugin: Voice not initialized');
            throw new Error('Voice not initialized');
        }

        await this.webrtc.startRecording();
        this.ui?.setVoiceActive(true);
        console.log('✅ Plugin: Voice input started');
    }

    public stopVoiceInput(): void {
        console.log('🔇 Plugin: Stopping voice input...');
        
        if (!this.sessionActive) {
            console.warn('⚠️ Plugin: No active session');
            return;
        }
        
        if (!this.webrtc) {
            console.warn('⚠️ Plugin: WebRTC not initialized, skipping');
            return;
        }

        this.webrtc.stopRecording();
        this.ui?.setVoiceActive(false);
        console.log('✅ Plugin: Voice input stopped');
    }

    private handleMessage(data: any): void {
        const message: Message = {
            id: data.id || this.generateId(),
            type: data.type || 'assistant',  // Use the type from data if provided
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
        
        // Enforce message limit - remove oldest messages if exceeded
        if (this.messages.length > this.MAX_MESSAGES) {
            const excess = this.messages.length - this.MAX_MESSAGES;
            this.messages.splice(0, excess); // Remove oldest messages
        }
        
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
        if (expanded) {
            this.expand();
        } else {
            this.minimize();
        }
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