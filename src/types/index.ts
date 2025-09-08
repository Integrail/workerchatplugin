export interface PluginConfig {
    // Required configuration
    endpoint: string;
    workerId: string;
    
    // Authentication
    auth?: AuthConfig;
    
    // UI Configuration
    ui?: UIConfig;
    
    // Feature flags
    features?: FeatureConfig;
    
    // Event callbacks
    callbacks?: CallbackConfig;
}

export interface AuthConfig {
    type: 'token' | 'jwt' | 'anonymous';
    token?: string | (() => Promise<string>);
    credentials?: {
        username?: string;
        password?: string;
    };
}

export interface UIConfig {
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    theme?: 'light' | 'dark' | 'auto';
    primaryColor?: string;
    container?: HTMLElement;
    customStyles?: string;
    zIndex?: number;
    buttonSize?: 'small' | 'medium' | 'large';
    expandedWidth?: string;
    expandedHeight?: string;
}

export interface FeatureConfig {
    voice?: boolean;
    text?: boolean;
    tools?: boolean;
    persistence?: 'none' | 'session' | 'local';
    autoConnect?: boolean;
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

export interface CallbackConfig {
    onConnect?: () => void;
    onDisconnect?: (reason?: string) => void;
    onMessage?: (message: Message) => void;
    onError?: (error: Error) => void;
    onStateChange?: (state: ConnectionState) => void;
    onTranscription?: (text: string, isFinal: boolean) => void;
}

export interface Message {
    id: string;
    type: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    source?: 'voice' | 'text';
    metadata?: Record<string, any>;
}

export type ConnectionState = 
    | 'disconnected'
    | 'connecting' 
    | 'connected'
    | 'reconnecting'
    | 'error';

export interface ConnectionAdapter {
    connect(): Promise<void>;
    disconnect(): void;
    sendMessage(message: string): Promise<void>;
    on(event: string, handler: Function): void;
    off(event: string, handler: Function): void;
    getState(): ConnectionState;
}

export interface VoiceSession {
    id: string;
    ephemeralKey: string;
    expiresAt: Date;
    model: string;
    voice?: string;
    instructions?: string;
    tools?: any[];
}

export interface RealtimeEvent {
    type: string;
    event_id?: string;
    [key: string]: any;
}

export interface AudioConfig {
    sampleRate?: number;
    channelCount?: number;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
}