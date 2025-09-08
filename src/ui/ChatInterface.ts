import { UIConfig, Message, ConnectionState } from '../types';
import { UICallbacks } from './UIManager';

/**
 * Chat interface component for the voice plugin
 */
export class ChatInterface {
    private container: HTMLElement;
    private messagesContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private textInput: HTMLInputElement;
    private voiceButton: HTMLButtonElement;
    private sendButton: HTMLButtonElement;
    private sessionButton: HTMLButtonElement;
    private config: UIConfig;
    private callbacks: UICallbacks;
    private messages: Message[] = [];
    private isVoiceActive = false;
    private transcriptionElement: HTMLElement | null = null;
    private responseElement: HTMLElement | null = null;
    private statusElement: HTMLElement | null = null;
    private isSpeechDetected = false;
    private currentTranscription = '';
    private currentResponse = '';
    private sessionActive = false;

    constructor(
        parent: HTMLElement,
        config: UIConfig,
        callbacks: UICallbacks,
        showHeader: boolean
    ) {
        this.config = config;
        this.callbacks = callbacks;
        this.container = this.createContainer(showHeader);
        parent.appendChild(this.container);
        
        this.messagesContainer = this.createMessagesContainer();
        this.sessionButton = this.createSessionButton();
        this.inputContainer = this.createInputContainer();
        this.textInput = this.createTextInput();
        this.voiceButton = this.createVoiceButton();
        this.sendButton = this.createSendButton();
        
        this.setupEventListeners();
    }

    private createContainer(showHeader: boolean): HTMLElement {
        const container = document.createElement('div');
        container.className = 'ew-chat-container';
        container.style.cssText = this.getContainerStyles();
        
        if (showHeader) {
            const header = this.createHeader();
            container.appendChild(header);
        }
        
        return container;
    }

    private getContainerStyles(): string {
        const width = this.config.expandedWidth || '380px';
        const height = this.config.expandedHeight || '600px';
        const theme = this.getTheme();
        
        return `
            width: ${width};
            height: ${height};
            background: ${theme.background};
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: ew-fade-in 0.3s ease;
        `;
    }

    private getTheme() {
        const isDark = this.config.theme === 'dark' || 
            (this.config.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        
        return {
            background: isDark ? '#1e1e1e' : '#ffffff',
            text: isDark ? '#ffffff' : '#333333',
            textSecondary: isDark ? '#a0a0a0' : '#666666',
            border: isDark ? '#333333' : '#e0e0e0',
            inputBg: isDark ? '#2d2d2d' : '#f5f5f5',
            messageBg: isDark ? '#2d2d2d' : '#f0f0f0',
            userMessageBg: this.config.primaryColor || '#007bff'
        };
    }

    private createHeader(): HTMLElement {
        const header = document.createElement('div');
        const theme = this.getTheme();
        
        header.className = 'ew-chat-header';
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid ${theme.border};
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const title = document.createElement('h3');
        title.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${theme.text};
        `;
        title.textContent = 'AI Assistant';
        
        const closeButton = document.createElement('button');
        closeButton.style.cssText = `
            background: none;
            border: none;
            color: ${theme.textSecondary};
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: background 0.2s;
            
            &:hover {
                background: ${theme.inputBg};
            }
        `;
        closeButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        closeButton.addEventListener('click', () => this.callbacks.onToggleExpanded(false));
        
        header.appendChild(title);
        header.appendChild(closeButton);
        
        return header;
    }

    private createMessagesContainer(): HTMLElement {
        const container = document.createElement('div');
        const theme = this.getTheme();
        
        container.className = 'ew-messages-container';
        container.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;
        
        this.container.appendChild(container);
        return container;
    }

    private createSessionButton(): HTMLButtonElement {
        const container = document.createElement('div');
        const button = document.createElement('button');
        const theme = this.getTheme();
        
        container.className = 'ew-session-control';
        container.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid ${theme.border};
            display: flex;
            justify-content: center;
            align-items: center;
            background: ${theme.background};
        `;
        
        button.className = 'ew-session-button';
        button.style.cssText = `
            padding: 10px 24px;
            border: none;
            border-radius: 24px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        
        // Set initial state (Start Session)
        button.style.background = '#28a745';
        button.style.color = 'white';
        button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Start Session
        `;
        
        container.appendChild(button);
        this.container.appendChild(container);
        return button;
    }

    private updateSessionButton(): void {
        if (!this.sessionButton) {
            return; // Button not yet created
        }
        
        const theme = this.getTheme();
        
        if (this.sessionActive) {
            this.sessionButton.style.background = '#dc3545';
            this.sessionButton.style.color = 'white';
            this.sessionButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                </svg>
                End Session
            `;
        } else {
            this.sessionButton.style.background = '#28a745';
            this.sessionButton.style.color = 'white';
            this.sessionButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Start Session
            `;
        }
    }

    private createInputContainer(): HTMLElement {
        const container = document.createElement('div');
        const theme = this.getTheme();
        
        container.className = 'ew-input-container';
        container.style.cssText = `
            padding: 16px;
            border-top: 1px solid ${theme.border};
            display: flex;
            gap: 8px;
            align-items: center;
        `;
        
        this.container.appendChild(container);
        return container;
    }

    private createTextInput(): HTMLInputElement {
        const input = document.createElement('input');
        const theme = this.getTheme();
        
        input.type = 'text';
        input.placeholder = 'Type a message...';
        input.className = 'ew-text-input';
        input.style.cssText = `
            flex: 1;
            padding: 10px 14px;
            border: 1px solid ${theme.border};
            border-radius: 24px;
            background: ${theme.inputBg};
            color: ${theme.text};
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
            
            &:focus {
                border-color: ${this.config.primaryColor || '#007bff'};
            }
        `;
        
        this.inputContainer.appendChild(input);
        return input;
    }

    private createVoiceButton(): HTMLButtonElement {
        const button = document.createElement('button');
        const theme = this.getTheme();
        
        button.className = 'ew-voice-button';
        button.setAttribute('aria-label', 'Voice input');
        button.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: none;
            background: ${theme.inputBg};
            color: ${theme.text};
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            
            &:hover {
                background: ${this.config.primaryColor || '#007bff'};
                color: white;
            }
        `;
        
        button.innerHTML = this.getMicIcon();
        
        this.inputContainer.appendChild(button);
        return button;
    }

    private createSendButton(): HTMLButtonElement {
        const button = document.createElement('button');
        
        button.className = 'ew-send-button';
        button.setAttribute('aria-label', 'Send message');
        button.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: none;
            background: ${this.config.primaryColor || '#007bff'};
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            
            &:hover {
                transform: scale(1.05);
            }
            
            &:active {
                transform: scale(0.95);
            }
        `;
        
        button.innerHTML = this.getSendIcon();
        
        this.inputContainer.appendChild(button);
        return button;
    }

    private getMicIcon(): string {
        return `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            </svg>
        `;
    }

    private getSendIcon(): string {
        return `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
        `;
    }

    private setupEventListeners(): void {
        // Session button click
        this.sessionButton.addEventListener('click', () => this.toggleSession());
        
        // Text input enter key
        this.textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Send button click
        this.sendButton.addEventListener('click', () => this.sendMessage());
        
        // Voice button click
        this.voiceButton.addEventListener('click', () => this.toggleVoice());
    }

    private toggleSession(): void {
        if (this.sessionActive) {
            this.callbacks.onEndSession();
        } else {
            this.callbacks.onStartSession();
        }
    }

    private sendMessage(): void {
        const text = this.textInput.value.trim();
        if (!text) return;
        
        this.callbacks.onSendMessage(text);
        this.textInput.value = '';
    }

    private toggleVoice(): void {
        if (this.isVoiceActive) {
            this.callbacks.onStopVoice();
        } else {
            this.callbacks.onStartVoice();
        }
    }

    public setVoiceActive(active: boolean): void {
        console.log('🎙️ ChatInterface: Voice active:', active);
        this.isVoiceActive = active;
        
        if (active) {
            this.voiceButton.style.background = '#f44336';
            this.voiceButton.style.color = 'white';
            this.voiceButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="9" y="9" width="6" height="6" rx="1"></rect>
                </svg>
            `;
            this.setSpeechDetected(true);
        } else {
            const theme = this.getTheme();
            this.voiceButton.style.background = theme.inputBg;
            this.voiceButton.style.color = theme.text;
            this.voiceButton.innerHTML = this.getMicIcon();
            this.setSpeechDetected(false);
        }
    }

    public addMessage(message: Message): void {
        this.messages.push(message);
        
        const messageElement = this.createMessageElement(message);
        this.messagesContainer.appendChild(messageElement);
        
        // Auto-scroll to bottom
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    private createMessageElement(message: Message): HTMLElement {
        const element = document.createElement('div');
        const theme = this.getTheme();
        const isUser = message.type === 'user';
        
        element.className = `ew-message ew-message-${message.type}`;
        element.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: ${isUser ? 'flex-end' : 'flex-start'};
            animation: ew-fade-in 0.3s ease;
        `;
        
        const bubble = document.createElement('div');
        bubble.className = 'ew-message-bubble';
        bubble.style.cssText = `
            max-width: 70%;
            padding: 10px 14px;
            border-radius: 18px;
            background: ${isUser ? theme.userMessageBg : theme.messageBg};
            color: ${isUser ? 'white' : theme.text};
            font-size: 14px;
            line-height: 1.4;
            word-wrap: break-word;
        `;
        bubble.textContent = message.content;
        
        if (message.source === 'voice') {
            const indicator = document.createElement('span');
            indicator.style.cssText = `
                display: inline-block;
                margin-left: 8px;
                opacity: 0.7;
                font-size: 12px;
            `;
            indicator.innerHTML = '🎤';
            bubble.appendChild(indicator);
        }
        
        element.appendChild(bubble);
        
        return element;
    }

    public setMessages(messages: Message[]): void {
        this.messages = messages;
        this.messagesContainer.innerHTML = '';
        messages.forEach(msg => this.addMessage(msg));
    }

    public clearMessages(): void {
        this.messages = [];
        this.messagesContainer.innerHTML = '';
    }

    public showTranscription(text: string, isFinal: boolean = false): void {
        console.log('📝 ChatInterface: Showing transcription:', text, 'Final:', isFinal);
        this.currentTranscription = text;
        this.updateLiveStatus();
        
        if (isFinal) {
            // Clear transcription after showing final
            setTimeout(() => {
                this.currentTranscription = '';
                this.updateLiveStatus();
            }, 2000);
        }
    }
    
    public showResponse(text: string, isDelta: boolean = false): void {
        console.log('💬 ChatInterface: Showing response:', text.substring(0, 50), 'Delta:', isDelta);
        if (isDelta) {
            this.currentResponse += text;
        } else {
            this.currentResponse = text;
        }
        this.updateLiveStatus();
    }
    
    public clearResponse(): void {
        this.currentResponse = '';
        this.updateLiveStatus();
    }
    
    public setSpeechDetected(detected: boolean): void {
        console.log('🎤 ChatInterface: Speech detected:', detected);
        this.isSpeechDetected = detected;
        this.updateLiveStatus();
    }
    
    private updateLiveStatus(): void {
        const theme = this.getTheme();
        
        // Create or update status container
        if (!this.statusElement) {
            this.statusElement = document.createElement('div');
            this.statusElement.className = 'ew-live-status';
            this.statusElement.style.cssText = `
                padding: 12px 20px;
                background: linear-gradient(135deg, ${theme.inputBg}, ${theme.messageBg});
                border-top: 1px solid ${theme.border};
                font-size: 13px;
                min-height: 60px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            `;
            // Insert before input container
            this.container.insertBefore(this.statusElement, this.inputContainer);
        }
        
        let statusHTML = '';
        
        // Show speech detection status
        if (this.isSpeechDetected) {
            statusHTML += `<div style="color: ${theme.textSecondary}; font-size: 12px;">🎤 Listening...</div>`;
        }
        
        // Show transcription
        if (this.currentTranscription) {
            statusHTML += `
                <div style="color: ${theme.text}; margin-top: 4px;">
                    <span style="color: ${theme.textSecondary}; font-size: 11px; display: block;">You said:</span>
                    <span style="font-style: italic;">"${this.currentTranscription}"</span>
                </div>
            `;
        }
        
        // Show AI response
        if (this.currentResponse) {
            statusHTML += `
                <div style="color: ${theme.text}; margin-top: 4px; padding: 8px; background: ${theme.userMessageBg}20; border-radius: 8px;">
                    <span style="color: ${theme.textSecondary}; font-size: 11px; display: block;">AI is responding...</span>
                    <span>${this.currentResponse}</span>
                </div>
            `;
        }
        
        // Only show status if there's actual content
        if (statusHTML) {
            this.statusElement.innerHTML = statusHTML;
            this.statusElement.style.display = 'flex';
        } else {
            this.statusElement.innerHTML = '';
            this.statusElement.style.display = 'none';
        }
        
        // Auto-scroll to show latest
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    public setConnectionState(state: ConnectionState): void {
        // Connection state is separate from session state
        // Don't automatically update session state here
        
        // Just update status display if needed
        if (state === 'connecting') {
            // Could show connecting status
        } else if (state === 'error') {
            // Could show error status
        }
    }

    public setSessionActive(active: boolean): void {
        this.sessionActive = active;
        this.updateSessionButton();
        
        // Enable/disable input controls based on session state
        this.textInput.disabled = !active;
        this.sendButton.disabled = !active;
        this.voiceButton.disabled = !active;
        
        if (!active) {
            this.textInput.placeholder = 'Start a session to begin chatting...';
        } else {
            this.textInput.placeholder = 'Type a message...';
        }
    }

    public showError(message: string): void {
        const errorElement = document.createElement('div');
        const theme = this.getTheme();
        
        errorElement.className = 'ew-error';
        errorElement.style.cssText = `
            padding: 12px;
            background: #f44336;
            color: white;
            font-size: 13px;
            border-radius: 8px;
            margin: 8px 20px;
            animation: ew-fade-in 0.3s ease;
        `;
        errorElement.textContent = message;
        
        this.messagesContainer.appendChild(errorElement);
        
        // Remove after 5 seconds
        setTimeout(() => errorElement.remove(), 5000);
    }

    public show(): void {
        this.container.style.display = 'flex';
    }

    public hide(): void {
        this.container.style.display = 'none';
    }

    public destroy(): void {
        this.container.remove();
    }
}