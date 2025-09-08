import { UIConfig, ConnectionState } from '../types';

/**
 * Floating action button for the voice plugin
 */
export class FloatingButton {
    private container: HTMLElement;
    private button: HTMLButtonElement;
    private badge: HTMLElement | null = null;
    private config: UIConfig;
    private onClick: () => void;
    private notificationCount = 0;

    constructor(parent: HTMLElement, config: UIConfig, onClick: () => void) {
        console.log('FloatingButton: Creating button with config:', config);
        this.config = config;
        this.onClick = onClick;
        this.container = this.createContainer();
        this.button = this.createButton();
        parent.appendChild(this.container);
        console.log('FloatingButton: Button created and appended to parent');
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'ew-button-container';
        container.style.cssText = this.getContainerStyles();
        return container;
    }

    private getContainerStyles(): string {
        const size = this.getSizePixels();
        return `
            position: relative;
            width: ${size}px;
            height: ${size}px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
    }

    private getSizePixels(): number {
        switch (this.config.buttonSize) {
            case 'small': return 48;
            case 'large': return 72;
            case 'medium':
            default: return 60;
        }
    }

    private createButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'ew-floating-button';
        button.setAttribute('aria-label', 'Open voice chat');
        button.style.cssText = this.getButtonStyles();
        
        // Add icon
        button.innerHTML = this.getButtonIcon();
        
        // Add click handler
        button.addEventListener('click', this.onClick);
        
        this.container.appendChild(button);
        return button;
    }

    private getButtonStyles(): string {
        const primaryColor = this.config.primaryColor || '#007bff';
        const size = this.getSizePixels();
        
        return `
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: ${primaryColor};
            border: none;
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        `;
    }

    private getButtonIcon(): string {
        return `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
        `;
    }

    public setConnectionState(state: ConnectionState): void {
        const color = this.getStateColor(state);
        
        // Add a small indicator dot
        let indicator = this.container.querySelector('.ew-connection-indicator') as HTMLElement;
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'ew-connection-indicator';
            indicator.style.cssText = `
                position: absolute;
                top: 0;
                right: 0;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                border: 2px solid white;
                z-index: 1;
            `;
            this.container.appendChild(indicator);
        }
        
        indicator.style.background = color;
        
        if (state === 'connecting' || state === 'reconnecting') {
            indicator.style.animation = 'ew-pulse 1.5s infinite';
        } else {
            indicator.style.animation = 'none';
        }
    }

    private getStateColor(state: ConnectionState): string {
        switch (state) {
            case 'connected': return '#4caf50';
            case 'connecting': 
            case 'reconnecting': return '#ff9800';
            case 'error': return '#f44336';
            case 'disconnected': 
            default: return '#9e9e9e';
        }
    }

    public showNotification(): void {
        this.notificationCount++;
        
        if (!this.badge) {
            this.badge = document.createElement('div');
            this.badge.className = 'ew-notification-badge';
            this.badge.style.cssText = `
                position: absolute;
                top: -4px;
                right: -4px;
                min-width: 20px;
                height: 20px;
                border-radius: 10px;
                background: #f44336;
                color: white;
                font-size: 12px;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 6px;
                border: 2px solid white;
                animation: ew-fade-in 0.3s ease;
            `;
            this.container.appendChild(this.badge);
        }
        
        this.badge.textContent = this.notificationCount.toString();
    }

    public clearNotifications(): void {
        this.notificationCount = 0;
        if (this.badge) {
            this.badge.remove();
            this.badge = null;
        }
    }

    public show(): void {
        this.container.style.display = 'flex';
        this.container.style.animation = 'ew-fade-in 0.3s ease';
        this.clearNotifications();
    }

    public hide(): void {
        this.container.style.animation = 'ew-fade-out 0.3s ease';
        setTimeout(() => {
            this.container.style.display = 'none';
        }, 300);
    }

    public destroy(): void {
        this.button.removeEventListener('click', this.onClick);
        this.container.remove();
    }
}