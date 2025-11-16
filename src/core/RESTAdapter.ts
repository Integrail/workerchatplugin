import { ConnectionAdapter, ConnectionState, PluginConfig } from '../types';
import { EventEmitter } from './EventEmitter';

/**
 * REST API adapter for Everworker Voice Plugin
 * Provides fallback communication when WebSocket/DDP is not available
 */
export class RESTAdapter extends EventEmitter implements ConnectionAdapter {
    private config: PluginConfig;
    private state: ConnectionState = 'disconnected';
    private pollInterval: any = null;
    private executionId: string | null = null;
    private lastMessageId: string | null = null;
    private baseUrl: string;
    private headers: Record<string, string> = {};

    constructor(config: PluginConfig) {
        super();
        this.config = config;
        
        // Convert ws/wss to http/https if needed
        let url = config.endpoint;
        if (url.startsWith('ws://')) {
            url = url.replace('ws://', 'http://');
        } else if (url.startsWith('wss://')) {
            url = url.replace('wss://', 'https://');
        }
        
        // Remove trailing slash
        this.baseUrl = url.replace(/\/$/, '');
    }

    public async connect(): Promise<void> {
        this.state = 'connecting';
        
        try {
            // Setup authentication headers
            await this.setupAuth();
            
            // Test connection with health check
            await this.healthCheck();
            
            this.state = 'connected';
            this.emit('connect');
            
            // Start polling for messages if we have an active execution
            if (this.executionId) {
                this.startPolling();
            }
        } catch (error) {
            this.state = 'error';
            this.emit('error', error);
            throw error;
        }
    }

    private async setupAuth(): Promise<void> {
        if (this.config.auth?.type === 'token' && this.config.auth.token) {
            const token = typeof this.config.auth.token === 'function'
                ? await this.config.auth.token()
                : this.config.auth.token;
            
            this.headers['Authorization'] = `Bearer ${token}`;
        } else if (this.config.auth?.type === 'jwt' && this.config.auth.token) {
            const token = typeof this.config.auth.token === 'function'
                ? await this.config.auth.token()
                : this.config.auth.token;
            
            this.headers['Authorization'] = `Bearer ${token}`;
        }
        
        // Always set content type
        this.headers['Content-Type'] = 'application/json';
    }

    private async healthCheck(): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/v1/agents/health`, {
            method: 'GET',
            headers: this.headers
        });

        if (!response.ok) {
            throw new Error(`Health check failed: ${response.statusText}`);
        }
    }

    public async sendMessage(text: string): Promise<void> {
        // REST adapter doesn't support text messaging for voice workers
        // Text messages must go through WebRTC data channel
        throw new Error('Text messages are only supported through WebRTC connection. Enable voice feature to send messages.');
    }

    private startPolling(): void {
        if (this.pollInterval) {
            return;
        }

        // Poll every 2 seconds for new messages
        this.pollInterval = setInterval(() => {
            this.pollForMessages();
        }, 2000);
    }

    private async pollForMessages(): Promise<void> {
        if (!this.executionId || this.state !== 'connected') {
            return;
        }

        try {
            const params = new URLSearchParams({
                executionId: this.executionId
            });
            
            if (this.lastMessageId) {
                params.append('after', this.lastMessageId);
            }

            const response = await fetch(`${this.baseUrl}/api/v1/execution-logs?${params}`, {
                method: 'GET',
                headers: this.headers
            });

            if (!response.ok) {
                console.error('Failed to poll for messages:', response.statusText);
                return;
            }

            const logs = await response.json();
            
            if (logs && logs.length > 0) {
                logs.forEach((log: any) => {
                    this.handleResponse(log);
                    this.lastMessageId = log.id;
                });
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }

    private handleResponse(data: any): void {
        // Convert response to message format
        const message = {
            id: data.id || Date.now().toString(),
            content: data.content || data.message || data.text || '',
            type: data.type || 'assistant',
            timestamp: data.timestamp || new Date().toISOString(),
            metadata: data.metadata || {}
        };

        this.emit('message', message);
    }

    public disconnect(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        
        this.state = 'disconnected';
        this.emit('disconnect');
    }

    public getState(): ConnectionState {
        return this.state;
    }

    // Voice-specific methods (REST implementation)
    public async getEphemeralKey(): Promise<any> {
        const response = await fetch(`${this.baseUrl}/api/v1/voice/ephemeral-key`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                workerId: this.config.workerId
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to get ephemeral key: ${response.statusText}`);
        }

        return response.json();
    }

    public async processRealtimeToolCall(toolCall: any): Promise<any> {
        const response = await fetch(`${this.baseUrl}/api/v1/voice/tool-call`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                workerId: this.config.workerId,
                toolCall
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to process tool call: ${response.statusText}`);
        }

        return response.json();
    }

    public async logConversationMessage(data: any): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/v1/voice/log-message`, {
            method: 'POST',
            headers: {
                ...this.headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`Failed to log message: ${response.statusText}`);
        }
    }

    // Helper method to make authenticated requests
    private async request(path: string, options: RequestInit = {}): Promise<Response> {
        const url = `${this.baseUrl}${path}`;
        
        return fetch(url, {
            ...options,
            headers: {
                ...this.headers,
                ...options.headers
            }
        });
    }
}