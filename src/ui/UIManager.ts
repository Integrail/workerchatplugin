import { UIConfig, Message, ConnectionState } from '../types';
import { ChatInterface } from './ChatInterface';
import { FloatingButton } from './FloatingButton';

export interface UICallbacks {
    onSendMessage: (text: string) => void;
    onStartVoice: () => void;
    onStopVoice: () => void;
    onToggleExpanded: (expanded: boolean) => void;
}

/**
 * Manages the UI components of the voice plugin
 * Uses Shadow DOM for style isolation
 */
export class UIManager {
    private config: UIConfig;
    private callbacks: UICallbacks;
    private container: HTMLElement;
    private shadowRoot: ShadowRoot;
    private button: FloatingButton | null = null;
    private chat: ChatInterface | null = null;
    private isExpanded = false;
    private isVisible = true;

    constructor(config: UIConfig, callbacks: UICallbacks) {
        console.log('UIManager: Initializing with config:', config);
        this.config = config;
        this.callbacks = callbacks;
        
        if (config.container) {
            console.log('UIManager: Using provided container');
            this.container = config.container;
            this.shadowRoot = this.container.attachShadow({ mode: 'open' });
            this.isExpanded = true; // Container mode starts expanded
        } else {
            console.log('UIManager: Creating floating container');
            this.container = this.createFloatingContainer();
            this.shadowRoot = this.container.attachShadow({ mode: 'open' });
            document.body.appendChild(this.container);
            console.log('UIManager: Container appended to body');
        }
        
        this.initialize();
        console.log('UIManager: Initialization complete');
    }

    private createFloatingContainer(): HTMLElement {
        const container = document.createElement('div');
        container.id = 'everworker-voice-plugin';
        container.style.cssText = `
            position: fixed;
            ${this.getPositionStyles()}
            z-index: ${this.config.zIndex || 9999};
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        `;
        return container;
    }

    private getPositionStyles(): string {
        const position = this.config.position || 'bottom-right';
        const offset = '20px';
        
        switch (position) {
            case 'bottom-right':
                return `bottom: ${offset}; right: ${offset};`;
            case 'bottom-left':
                return `bottom: ${offset}; left: ${offset};`;
            case 'top-right':
                return `top: ${offset}; right: ${offset};`;
            case 'top-left':
                return `top: ${offset}; left: ${offset};`;
            default:
                return `bottom: ${offset}; right: ${offset};`;
        }
    }

    private initialize(): void {
        console.log('UIManager: Starting initialization');
        // Add styles
        this.injectStyles();
        
        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'ew-wrapper';
        this.shadowRoot.appendChild(wrapper);
        console.log('UIManager: Wrapper created and appended');
        
        // Create components based on mode
        if (!this.config.container) {
            // Floating mode - create button
            console.log('UIManager: Creating floating button');
            this.button = new FloatingButton(
                wrapper,
                this.config,
                () => this.toggleExpanded()
            );
            console.log('UIManager: Floating button created');
        }
        
        // Create chat interface
        console.log('UIManager: Creating chat interface');
        this.chat = new ChatInterface(
            wrapper,
            this.config,
            this.callbacks,
            !this.config.container // Show header in floating mode
        );
        console.log('UIManager: Chat interface created');
        
        // Set initial state
        if (this.config.container) {
            this.chat.show();
        } else {
            this.chat.hide();
        }
        console.log('UIManager: Initial state set');
    }

    private injectStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }
            
            .ew-wrapper {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 12px;
            }
            
            /* Button styles */
            .ew-floating-button:hover {
                transform: scale(1.05);
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
            }
            
            .ew-floating-button:active {
                transform: scale(0.95);
            }
            
            /* Animations */
            @keyframes ew-fade-in {
                from { opacity: 0; transform: scale(0.95); }
                to { opacity: 1; transform: scale(1); }
            }
            
            @keyframes ew-fade-out {
                from { opacity: 1; transform: scale(1); }
                to { opacity: 0; transform: scale(0.95); }
            }
            
            @keyframes ew-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }
            
            /* Scrollbar styles */
            ::-webkit-scrollbar {
                width: 6px;
            }
            
            ::-webkit-scrollbar-track {
                background: transparent;
            }
            
            ::-webkit-scrollbar-thumb {
                background: rgba(0, 0, 0, 0.2);
                border-radius: 3px;
            }
            
            ::-webkit-scrollbar-thumb:hover {
                background: rgba(0, 0, 0, 0.3);
            }
            
            /* Dark mode adjustments */
            @media (prefers-color-scheme: dark) {
                ::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.2);
                }
                
                ::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.3);
                }
            }
            
            /* Custom styles from config */
            ${this.config.customStyles || ''}
        `;
        
        this.shadowRoot.appendChild(style);
    }

    private toggleExpanded(): void {
        this.isExpanded = !this.isExpanded;
        
        if (this.isExpanded) {
            this.expand();
        } else {
            this.minimize();
        }
        
        this.callbacks.onToggleExpanded(this.isExpanded);
    }

    public show(): void {
        this.isVisible = true;
        this.container.style.display = 'block';
    }

    public hide(): void {
        this.isVisible = false;
        this.container.style.display = 'none';
    }

    public minimize(): void {
        if (this.chat) {
            this.chat.hide();
        }
        if (this.button) {
            this.button.show();
        }
        this.isExpanded = false;
    }

    public expand(): void {
        if (this.button) {
            this.button.hide();
        }
        if (this.chat) {
            this.chat.show();
        }
        this.isExpanded = true;
    }

    public setConnectionState(state: ConnectionState): void {
        if (this.button) {
            this.button.setConnectionState(state);
        }
        if (this.chat) {
            this.chat.setConnectionState(state);
        }
    }

    public addMessage(message: Message): void {
        if (this.chat) {
            this.chat.addMessage(message);
        }
        
        // Show notification badge if minimized
        if (!this.isExpanded && this.button) {
            this.button.showNotification();
        }
    }

    public setMessages(messages: Message[]): void {
        if (this.chat) {
            this.chat.setMessages(messages);
        }
    }

    public clearMessages(): void {
        if (this.chat) {
            this.chat.clearMessages();
        }
    }

    public showTranscription(text: string, isFinal: boolean = false): void {
        if (this.chat) {
            this.chat.showTranscription(text, isFinal);
        }
    }
    
    public showResponse(text: string, isDelta: boolean = false): void {
        if (this.chat) {
            this.chat.showResponse(text, isDelta);
        }
    }
    
    public clearResponse(): void {
        if (this.chat) {
            this.chat.clearResponse();
        }
    }
    
    public setSpeechDetected(detected: boolean): void {
        if (this.chat) {
            this.chat.setSpeechDetected(detected);
        }
    }

    public setVoiceActive(active: boolean): void {
        if (this.chat) {
            this.chat.setVoiceActive(active);
        }
    }

    public showError(message: string): void {
        if (this.chat) {
            this.chat.showError(message);
        }
    }

    public destroy(): void {
        if (this.button) {
            this.button.destroy();
        }
        if (this.chat) {
            this.chat.destroy();
        }
        
        // Remove container if it was created by us
        if (!this.config.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }
}