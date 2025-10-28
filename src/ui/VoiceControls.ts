import { icons } from './icons';

/**
 * Voice Controls Component
 * Bottom-centered control bar with mic (+ glow), CC toggle, and stop buttons
 * Inspired by voice-code design
 */
export class VoiceControls {
    private container: HTMLElement;
    private micButton: HTMLButtonElement;
    private ccButton: HTMLButtonElement;
    private stopButton: HTMLButtonElement;
    private glowRing1: HTMLElement;
    private glowRing2: HTMLElement;
    private isListening: boolean = false;
    private isCCEnabled: boolean = false;
    private onMicClick: () => void;
    private onCCClick: () => void;
    private onStopClick: () => void;

    constructor(
        parent: HTMLElement,
        callbacks: {
            onMicClick: () => void;
            onCCClick: () => void;
            onStopClick: () => void;
        }
    ) {
        this.onMicClick = callbacks.onMicClick;
        this.onCCClick = callbacks.onCCClick;
        this.onStopClick = callbacks.onStopClick;

        this.container = this.createContainer();
        this.glowRing1 = this.createGlowRing(1);
        this.glowRing2 = this.createGlowRing(2);
        this.micButton = this.createMicButton();
        this.ccButton = this.createCCButton();
        this.stopButton = this.createStopButton();

        parent.appendChild(this.container);
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'ew-voice-controls';
        container.style.cssText = `
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10;
            display: flex;
            gap: 20px;
            align-items: center;
            justify-content: center;
        `;
        return container;
    }

    private createGlowRing(index: number): HTMLElement {
        const ring = document.createElement('div');
        ring.className = `ew-glow-ring-${index}`;
        ring.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 2px solid #ff0d40;
            opacity: 0;
            pointer-events: none;
            z-index: -1;
        `;

        // Different animation for each ring
        if (index === 1) {
            ring.style.animation = 'ew-glow-pulse-1 0.9s ease-in-out infinite';
        } else {
            ring.style.animation = 'ew-glow-pulse-2 1.1s ease-in-out infinite';
        }

        return ring;
    }

    private createMicButton(): HTMLButtonElement {
        const micContainer = document.createElement('div');
        micContainer.style.cssText = `
            position: relative;
            width: 50px;
            height: 50px;
        `;

        const button = document.createElement('button');
        button.className = 'ew-mic-button';
        button.setAttribute('aria-label', 'Toggle microphone');
        button.style.cssText = `
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: white;
            border: 2px solid black;
            color: black;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            position: relative;
            z-index: 1;
        `;

        button.innerHTML = icons.mic;
        button.addEventListener('click', () => this.handleMicClick());

        // Add hover effects
        button.addEventListener('mouseenter', () => {
            if (this.isListening) {
                // Pause animation on hover when listening
                this.glowRing1.style.animationPlayState = 'paused';
                this.glowRing2.style.animationPlayState = 'paused';
            }
        });

        button.addEventListener('mouseleave', () => {
            if (this.isListening) {
                this.glowRing1.style.animationPlayState = 'running';
                this.glowRing2.style.animationPlayState = 'running';
            }
        });

        micContainer.appendChild(this.glowRing1);
        micContainer.appendChild(this.glowRing2);
        micContainer.appendChild(button);
        this.container.appendChild(micContainer);

        return button;
    }

    private createCCButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'ew-cc-button';
        button.setAttribute('aria-label', 'Toggle closed captions');
        button.style.cssText = `
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: white;
            border: 2px solid black;
            color: black;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            position: relative;
        `;

        button.innerHTML = icons.subtitles;

        // Add diagonal slash overlay for "off" state
        const slashOverlay = document.createElement('div');
        slashOverlay.className = 'ew-cc-slash';
        slashOverlay.style.cssText = `
            position: absolute;
            width: 2px;
            height: 60px;
            background: black;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            pointer-events: none;
        `;
        button.appendChild(slashOverlay);

        button.addEventListener('click', () => this.handleCCClick());
        this.container.appendChild(button);

        return button;
    }

    private createStopButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'ew-stop-button';
        button.setAttribute('aria-label', 'Stop voice session');
        button.style.cssText = `
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: #ff0d40;
            border: none;
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        `;

        button.innerHTML = icons.square;

        // Hover effect
        button.addEventListener('mouseenter', () => {
            button.style.background = '#e00c3a';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background = '#ff0d40';
        });

        button.addEventListener('click', () => this.handleStopClick());
        this.container.appendChild(button);

        return button;
    }

    private handleMicClick(): void {
        this.onMicClick();
    }

    private handleCCClick(): void {
        this.isCCEnabled = !this.isCCEnabled;
        this.updateCCButton();
        this.onCCClick();
    }

    private handleStopClick(): void {
        this.onStopClick();
    }

    /**
     * Set listening state (controls mic button appearance and glow)
     */
    public setListening(listening: boolean): void {
        this.isListening = listening;

        if (listening) {
            // Active state: red border, show glows
            this.micButton.style.borderColor = '#ff0d40';
            this.micButton.style.color = '#ff0d40';
            this.glowRing1.style.opacity = '1';
            this.glowRing2.style.opacity = '1';
        } else {
            // Inactive state: black border, hide glows
            this.micButton.style.borderColor = 'black';
            this.micButton.style.color = 'black';
            this.glowRing1.style.opacity = '0';
            this.glowRing2.style.opacity = '0';
        }
    }

    /**
     * Enable/disable CC
     */
    public setCCEnabled(enabled: boolean): void {
        this.isCCEnabled = enabled;
        this.updateCCButton();
    }

    private updateCCButton(): void {
        const slash = this.ccButton.querySelector('.ew-cc-slash') as HTMLElement;

        if (this.isCCEnabled) {
            // Enabled: red border, hide slash
            this.ccButton.style.borderColor = '#ff0d40';
            this.ccButton.style.color = '#ff0d40';
            if (slash) slash.style.display = 'none';
        } else {
            // Disabled: black border, show slash
            this.ccButton.style.borderColor = 'black';
            this.ccButton.style.color = 'black';
            if (slash) slash.style.display = 'block';
        }
    }

    /**
     * Show/hide controls
     */
    public show(): void {
        this.container.style.display = 'flex';
    }

    public hide(): void {
        this.container.style.display = 'none';
    }

    /**
     * Cleanup
     */
    public destroy(): void {
        this.container.remove();
    }
}
