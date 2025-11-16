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
    // Timeout constants
    private static readonly DEFAULT_SESSION_TIMEOUT_MS = 15 * 60 * 1000;  // 15 minutes
    private static readonly DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;       // 5 minutes
    private static readonly SESSION_WARNING_BEFORE_MS = 60 * 1000;         // 1 minute
    private static readonly IDLE_GRACE_PERIOD_MS = 60 * 1000;              // 1 minute

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
    private sessionWarningTimer: any = null;
    private sessionId: string | null = null;
    private lastActivityTime: number | null = null;
    private idleTimeoutTimer: any = null;
    private idleGracePeriodTimer: any = null;
    private idleWarningShown = false;
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
        const validated: PluginConfig = {
            ...config,
            auth: config.auth || { type: 'anonymous' },
            ui: {
                position: 'bottom-right' as const,
                theme: 'auto' as const,
                zIndex: 9999,
                buttonSize: 'medium' as const,
                expandedWidth: '380px',
                expandedHeight: '600px',
                ...config.ui
            },
            features: {
                voice: true,
                text: true,
                tools: false,
                persistence: 'session' as const,
                autoConnect: true,
                reconnect: true,
                reconnectInterval: 5000,
                maxReconnectAttempts: 10,
                sessionTimeout: EverworkerVoicePlugin.DEFAULT_SESSION_TIMEOUT_MS,
                idleTimeout: EverworkerVoicePlugin.DEFAULT_IDLE_TIMEOUT_MS,
                enableIdleCheck: true,
                ...config.features
            },
            callbacks: config.callbacks || {}
        };

        // Validate timeout relationships
        const sessionTimeout = validated.features?.sessionTimeout;
        const idleTimeout = validated.features?.idleTimeout;

        if (sessionTimeout !== null && sessionTimeout !== undefined &&
            idleTimeout !== undefined && idleTimeout >= sessionTimeout) {
            console.warn(
                `⚠️ Plugin: idleTimeout (${idleTimeout}ms) should be less than ` +
                `sessionTimeout (${sessionTimeout}ms). Adjusting idleTimeout to 80% of sessionTimeout.`
            );
            validated.features!.idleTimeout = Math.floor(sessionTimeout * 0.8);
        }

        return validated;
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
            // Always call setMessages to trigger welcome message check
            this.ui.setMessages(this.messages);

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
                // Reset activity on speech detection
                this.resetActivity();
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

            // Handle data channel ready event
            this.webrtc.on('dataChannel:ready', () => {
                console.log('✅ Plugin: Data channel is ready');
                this.emit('dataChannel:ready');
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

    public async disconnect(): Promise<void> {
        this.clearReconnectTimer();
        
        if (this.webrtc) {
            await this.webrtc.cleanup();
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

        // Reset activity timer on user message
        this.resetActivity();

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

        // Show loading state in UI
        this.ui?.setSessionLoading(true);

        // Optionally clear message history
        if (clearHistory) {
            this.clearMessages();
        }

        try {
            // Connect to server
            await this.connect();

            // Get server-generated session ID from WebRTC session
            const session = this.webrtc?.getSession();
            if (session && session.sessionId) {
                this.sessionId = session.sessionId;
                console.log('📝 Using server-generated session ID:', this.sessionId);
            } else {
                // Fallback to client-generated session ID if server doesn't provide one
                this.sessionId = this.generateSessionId();
                console.warn('⚠️ No server session ID, using client-generated:', this.sessionId);
            }

            // Mark session as active
            this.sessionActive = true;
            this.sessionStartTime = new Date();

            // Update UI
            this.ui?.setSessionActive(true);
            this.ui?.setSessionLoading(false);
            
            // Auto-start microphone
            try {
                console.log('🎤 Plugin: Auto-starting microphone...');
                await this.startVoiceInput();
            } catch (error) {
                console.warn('⚠️ Plugin: Could not auto-start microphone:', error);
                // Don't fail the session if mic can't start
            }
            
            // Set up session timeout (configurable hard timeout)
            this.setupSessionTimeout();

            // Set up idle timeout (activity-based timeout)
            this.setupIdleTimeout();

            console.log('✅ Plugin: Voice session started');
            this.emit('session:started');

            // Send automatic "hi" message once data channel is ready
            this.sendGreetingWhenReady();
        } catch (error) {
            console.error('❌ Plugin: Failed to start session:', error);
            this.sessionActive = false;
            this.ui?.setSessionLoading(false);
            throw error;
        }
    }

    public async endSession(): Promise<void> {
        console.log('🛑 Plugin: Ending voice session...');
        
        if (!this.sessionActive) {
            console.warn('⚠️ Plugin: No active session');
            return;
        }

        // Clear timeout timers
        this.clearSessionTimeout();
        this.clearIdleTimeout();

        // Reset idle-related state
        this.lastActivityTime = null;
        this.idleWarningShown = false;

        // First, stop voice input if active
        try {
            console.log('🔇 Plugin: Stopping voice input before disconnect...');
            this.stopVoiceInput();
        } catch (error) {
            console.warn('⚠️ Plugin: Error stopping voice input:', error);
        }
        
        // Disconnect WebRTC and connection (await the async operation)
        await this.disconnect();
        
        // Mark session as inactive
        this.sessionActive = false;
        this.sessionStartTime = null;
        this.sessionId = null;

        // Update UI
        this.ui?.setSessionActive(false);

        console.log('✅ Plugin: Voice session ended');
        this.emit('session:ended');
    }

    private sendGreetingWhenReady(): void {
        // Check if data channel is already ready
        if (this.webrtc && (this.webrtc as any).dataChannel?.readyState === 'open') {
            console.log('👋 Plugin: Data channel already open, sending greeting immediately');
            this.sendMessage('hi').catch(error => {
                console.warn('⚠️ Plugin: Could not send automatic greeting:', error);
            });
            return;
        }

        // Otherwise, wait for the dataChannel:ready event
        console.log('⏳ Plugin: Waiting for data channel to be ready...');
        const onDataChannelReady = async () => {
            try {
                console.log('👋 Plugin: Data channel ready, sending greeting message...');
                await this.sendMessage('hi');
                // Remove the listener after successful send
                this.off('dataChannel:ready', onDataChannelReady);
            } catch (error) {
                console.warn('⚠️ Plugin: Could not send automatic greeting:', error);
                // Don't fail the session if greeting can't be sent
            }
        };

        this.once('dataChannel:ready', onDataChannelReady);
    }

    private setupSessionTimeout(): void {
        // Clear any existing timer
        this.clearSessionTimeout();

        const features = this.config.features;
        const sessionTimeout = features?.sessionTimeout;

        // Check if session timeout is disabled (null value)
        if (sessionTimeout === null) {
            console.log('⏭️ Plugin: Session hard timeout disabled');
            return;
        }

        // Use configured timeout or default
        const timeoutMs = sessionTimeout || EverworkerVoicePlugin.DEFAULT_SESSION_TIMEOUT_MS;
        const warningMs = timeoutMs - EverworkerVoicePlugin.SESSION_WARNING_BEFORE_MS;

        console.log(`⏰ Plugin: Setting up session timeout (${timeoutMs / 1000}s)`);

        // Warning before timeout
        if (warningMs > 0) {
            this.sessionWarningTimer = setTimeout(() => {
                if (this.sessionActive) {
                    console.warn('⚠️ Plugin: Session will timeout in 1 minute');
                    this.ui?.showError('Session will timeout in 1 minute. Please save your work.');
                    this.emit('session:timeout-warning');
                }
            }, warningMs);
        }

        // Auto-disconnect at timeout
        this.sessionTimeoutTimer = setTimeout(() => {
            if (this.sessionActive) {
                console.warn('⏰ Plugin: Session timeout reached, disconnecting...');
                this.ui?.showError(`Session timed out after ${timeoutMs / 60000} minutes. Please start a new session.`);
                this.endSession();
                this.emit('session:timeout');
            }
        }, timeoutMs);
    }

    private clearSessionTimeout(): void {
        if (this.sessionWarningTimer) {
            clearTimeout(this.sessionWarningTimer);
            this.sessionWarningTimer = null;
        }
        if (this.sessionTimeoutTimer) {
            clearTimeout(this.sessionTimeoutTimer);
            this.sessionTimeoutTimer = null;
        }
    }

    private setupIdleTimeout(): void {
        const features = this.config.features;

        // Check if idle check is enabled (default: true)
        if (features?.enableIdleCheck === false) {
            console.log('⏭️ Plugin: Idle timeout disabled');
            return;
        }

        const idleTimeout = features?.idleTimeout || EverworkerVoicePlugin.DEFAULT_IDLE_TIMEOUT_MS;

        console.log(`⏰ Plugin: Setting up idle timeout (${idleTimeout / 1000}s)`);

        // Clear any existing timer
        this.clearIdleTimeout();

        // Reset activity tracking
        this.lastActivityTime = Date.now();
        this.idleWarningShown = false;

        // Set up idle check timer
        this.idleTimeoutTimer = setTimeout(() => {
            if (this.sessionActive && !this.idleWarningShown) {
                this.handleIdleWarning();
            }
        }, idleTimeout);
    }

    private clearIdleTimeout(): void {
        if (this.idleTimeoutTimer) {
            clearTimeout(this.idleTimeoutTimer);
            this.idleTimeoutTimer = null;
        }
        if (this.idleGracePeriodTimer) {
            clearTimeout(this.idleGracePeriodTimer);
            this.idleGracePeriodTimer = null;
        }
    }

    private resetActivity(): void {
        if (!this.sessionActive) return;

        const features = this.config.features;
        if (features?.enableIdleCheck === false) return;

        console.log('🔄 Plugin: Activity detected, resetting idle timer');
        this.lastActivityTime = Date.now();
        this.idleWarningShown = false;

        // Clear grace period timer if user becomes active again
        if (this.idleGracePeriodTimer) {
            clearTimeout(this.idleGracePeriodTimer);
            this.idleGracePeriodTimer = null;
        }

        // Reset the idle timeout timer directly (avoid recursive setupIdleTimeout call)
        const idleTimeout = features?.idleTimeout || EverworkerVoicePlugin.DEFAULT_IDLE_TIMEOUT_MS;

        if (this.idleTimeoutTimer) {
            clearTimeout(this.idleTimeoutTimer);
        }

        this.idleTimeoutTimer = setTimeout(() => {
            if (this.sessionActive && !this.idleWarningShown) {
                this.handleIdleWarning();
            }
        }, idleTimeout);
    }

    private handleIdleWarning(): void {
        console.log('⚠️ Plugin: User idle, sending check-in message');

        this.idleWarningShown = true;

        // Get custom message or use default
        const message = this.config.features?.idleCheckMessage ||
            "Are you still there? Do you have any other questions or shall we finish the session?";

        // Create a simulated assistant message
        const checkInMessage: Message = {
            id: this.generateId(),
            type: 'assistant',
            content: message,
            timestamp: new Date(),
            source: 'text',
            metadata: { automated: true, type: 'idle-check' }
        };

        // Add to UI and message history
        this.addMessage(checkInMessage);

        // Emit event for callbacks
        this.emit('session:idle-warning');

        // Set timer to end session if no response within grace period
        this.idleGracePeriodTimer = setTimeout(() => {
            if (this.sessionActive && this.idleWarningShown) {
                console.log('⏰ Plugin: No response to idle check, ending session');
                this.ui?.showError('Session ended due to inactivity.');
                this.endSession();
                this.emit('session:idle-timeout');
            }
        }, EverworkerVoicePlugin.IDLE_GRACE_PERIOD_MS);
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

        // Reset activity on assistant messages (conversation is active)
        if (message.type === 'assistant' && !message.metadata?.automated) {
            this.resetActivity();
        }

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

        // Async backend logging (fire-and-forget, non-blocking)
        this.syncMessageToBackend(message);
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

    private generateSessionId(): string {
        // Generate UUID v4
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    private syncMessageToBackend(message: Message): void {
        // Fire-and-forget async logging to backend
        if (!this.connection || !this.sessionId) return;
        if (!('logConversationMessage' in this.connection)) return;

        (this.connection as any).logConversationMessage({
            workerId: this.config.workerId,
            sessionId: this.sessionId,
            message: {
                id: message.id,
                type: message.type,
                content: message.content,
                timestamp: message.timestamp,
                source: message.source
            }
        }).catch((error: Error) => {
            console.warn('Failed to sync message to backend:', error);
            // Don't throw - let conversation continue
        });
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

    /**
     * Manually reset the idle timer to prevent session timeout
     * Useful for scenarios where user is actively engaged but not sending messages
     * (e.g., reading long responses, reviewing content)
     */
    public resetIdleTimer(): void {
        if (!this.sessionActive) {
            console.warn('⚠️ Plugin: No active session');
            return;
        }
        console.log('👤 Plugin: Manually resetting idle timer');
        this.resetActivity();
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