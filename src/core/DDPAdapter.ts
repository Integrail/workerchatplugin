import { ConnectionAdapter, ConnectionState, PluginConfig } from '../types';
import { EventEmitter } from './EventEmitter';

interface DDPMessage {
    msg: string;
    id?: string;
    method?: string;
    params?: any[];
    result?: any;
    error?: any;
    name?: string;
    subs?: string[];
    collection?: string;
    fields?: any;
}

/**
 * Minimal DDP client implementation for Everworker Voice Plugin
 * Implements only the necessary DDP protocol features for voice/chat communication
 */
export class DDPAdapter extends EventEmitter implements ConnectionAdapter {
    private config: PluginConfig;
    private ws: WebSocket | null = null;
    private state: ConnectionState = 'disconnected';
    private messageId = 0;
    private pendingCalls: Map<string, { resolve: Function; reject: Function }> = new Map();
    private subscriptions: Map<string, string> = new Map();
    private heartbeatInterval: any = null;

    constructor(config: PluginConfig) {
        super();
        this.config = config;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // Convert http(s) to ws(s) if needed
                let wsUrl = this.config.endpoint;
                if (wsUrl.startsWith('http://')) {
                    wsUrl = wsUrl.replace('http://', 'ws://');
                } else if (wsUrl.startsWith('https://')) {
                    wsUrl = wsUrl.replace('https://', 'wss://');
                }

                // Add websocket path if not present
                if (!wsUrl.includes('/websocket')) {
                    wsUrl = wsUrl.replace(/\/$/, '') + '/websocket';
                }

                this.ws = new WebSocket(wsUrl);
                this.setupWebSocketHandlers(resolve, reject);
            } catch (error) {
                this.state = 'error';
                reject(error);
            }
        });
    }

    private setupWebSocketHandlers(resolve: Function, reject: Function): void {
        if (!this.ws) return;

        this.ws.onopen = () => {
            console.log('DDP: WebSocket connected');
            this.sendConnect();
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message, resolve);
            } catch (error) {
                console.error('DDP: Failed to parse message', error);
            }
        };

        this.ws.onerror = (error) => {
            console.error('DDP: WebSocket error', error);
            this.state = 'error';
            this.emit('error', error);
            reject(error);
        };

        this.ws.onclose = () => {
            console.log('DDP: WebSocket closed');
            this.cleanup();
            this.state = 'disconnected';
            this.emit('disconnect');
        };
    }

    private sendConnect(): void {
        this.send({
            msg: 'connect',
            version: '1',
            support: ['1', 'pre2', 'pre1']
        });
    }

    private handleMessage(message: DDPMessage, connectResolve?: Function): void {
        switch (message.msg) {
            case 'connected':
                // Session ID received from server
                this.state = 'connected';
                this.startHeartbeat();
                if (connectResolve) {
                    connectResolve();
                }
                // Authenticate if needed
                if (this.config.auth?.type !== 'anonymous') {
                    this.authenticate();
                }
                break;

            case 'ping':
                this.send({ msg: 'pong', id: message.id });
                break;

            case 'pong':
                // Heartbeat response received
                break;

            case 'result':
                this.handleMethodResult(message);
                break;

            case 'added':
            case 'changed':
            case 'removed':
                this.handleCollectionChange(message);
                break;

            case 'ready':
                this.handleSubscriptionReady(message);
                break;

            case 'nosub':
                this.handleSubscriptionError(message);
                break;

            case 'error':
                console.error('DDP: Server error', message.error);
                this.emit('error', new Error(message.error?.message || 'Server error'));
                break;

            default:
                console.log('DDP: Unhandled message type', message.msg);
        }
    }

    private async authenticate(): Promise<void> {
        if (this.config.auth?.type === 'token' && this.config.auth.token) {
            const token = typeof this.config.auth.token === 'function' 
                ? await this.config.auth.token() 
                : this.config.auth.token;

            // Call login method with token
            this.call('login', [{ resume: token }]).catch(error => {
                console.error('DDP: Authentication failed', error);
                // For voice plugin, we might still work in anonymous mode
            });
        }
    }

    private handleMethodResult(message: DDPMessage): void {
        if (!message.id) return;

        const pending = this.pendingCalls.get(message.id);
        if (!pending) return;

        this.pendingCalls.delete(message.id);

        if (message.error) {
            pending.reject(new Error(message.error.message || 'Method call failed'));
        } else {
            pending.resolve(message.result);
        }
    }

    private handleCollectionChange(message: DDPMessage): void {
        // Emit collection changes for the UI to handle
        this.emit('collection:change', {
            type: message.msg,
            collection: message.collection,
            id: message.id,
            fields: message.fields
        });
    }

    private handleSubscriptionReady(message: DDPMessage): void {
        if (message.subs) {
            message.subs.forEach(subId => {
                const subName = this.subscriptions.get(subId);
                if (subName) {
                    this.emit('subscription:ready', subName);
                }
            });
        }
    }

    private handleSubscriptionError(message: DDPMessage): void {
        if (message.id) {
            const subName = this.subscriptions.get(message.id);
            if (subName) {
                this.subscriptions.delete(message.id);
                this.emit('subscription:error', subName, message.error);
            }
        }
    }

    public async sendMessage(text: string): Promise<void> {
        // Text messages should be sent through WebRTC data channel, not DDP
        // This is just a placeholder for the interface
        throw new Error('Text messages should be sent through WebRTC connection. Use WebRTCManager.sendTextMessage()');
    }

    public call(method: string, params: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = this.getNextId();
            
            this.pendingCalls.set(id, { resolve, reject });
            
            this.send({
                msg: 'method',
                method,
                params,
                id
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingCalls.has(id)) {
                    this.pendingCalls.delete(id);
                    reject(new Error('Method call timeout'));
                }
            }, 30000);
        });
    }

    public subscribe(name: string, ...params: any[]): string {
        const id = this.getNextId();
        
        this.subscriptions.set(id, name);
        
        this.send({
            msg: 'sub',
            name,
            params,
            id
        });

        return id;
    }

    public unsubscribe(id: string): void {
        if (this.subscriptions.has(id)) {
            this.subscriptions.delete(id);
            this.send({
                msg: 'unsub',
                id
            });
        }
    }

    private send(message: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    private getNextId(): string {
        return (++this.messageId).toString();
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        
        // Send ping every 25 seconds
        this.heartbeatInterval = setInterval(() => {
            if (this.state === 'connected') {
                this.send({
                    msg: 'ping',
                    id: this.getNextId()
                });
            }
        }, 25000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private cleanup(): void {
        this.stopHeartbeat();
        this.pendingCalls.clear();
        this.subscriptions.clear();
    }

    public disconnect(): void {
        this.cleanup();
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.state = 'disconnected';
    }

    public getState(): ConnectionState {
        return this.state;
    }

    // Voice-specific methods
    public async getEphemeralKey(): Promise<any> {
        // Get JWT token if available
        const jwtToken = this.getJwtToken();
        
        // Pass workerId, selectedVoice (undefined), and JWT token
        return this.call('voice.getEphemeralKey', [
            this.config.workerId,
            undefined, // selectedVoice
            jwtToken
        ]);
    }

    public async processRealtimeToolCall(toolCall: any): Promise<any> {
        // Get JWT token if available
        const jwtToken = this.getJwtToken();

        return this.call('voice.processRealtimeToolCall', [
            toolCall,
            this.config.workerId,
            undefined, // sessionId
            jwtToken
        ]);
    }

    public async logConversationMessage(data: any): Promise<void> {
        // Get JWT token if available
        const jwtToken = this.getJwtToken();

        return this.call('voice.logConversationMessage', [
            data,
            jwtToken
        ]);
    }

    private getJwtToken(): string | undefined {
        if (this.config.auth?.type === 'token' && this.config.auth.token) {
            // If token is a function, it should return the JWT token
            // If it's a string, use it directly
            const token = typeof this.config.auth.token === 'string' 
                ? this.config.auth.token 
                : undefined;
            return token;
        }
        return undefined;
    }
}