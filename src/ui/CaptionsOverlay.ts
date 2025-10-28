/**
 * Captions Overlay Component
 * Displays transcription text with word-by-word fade-in animation
 * Inspired by voice-code design
 */
export class CaptionsOverlay {
    private container: HTMLElement;
    private captionsElement: HTMLElement;
    private currentWords: HTMLElement[] = [];
    private animationInterval: number = 450; // ms between word animations
    private currentText: string = '';

    constructor(parent: HTMLElement) {
        this.container = this.createContainer();
        this.captionsElement = this.createCaptionsElement();
        this.createFadeOverlay();
        parent.appendChild(this.container);
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'ew-captions-overlay';
        container.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 280px;
            height: 160px;
            z-index: 10;
            display: none;
            pointer-events: none;
        `;
        return container;
    }

    private createCaptionsElement(): HTMLElement {
        const captions = document.createElement('div');
        captions.className = 'ew-captions-text';
        captions.style.cssText = `
            width: 100%;
            height: 100%;
            overflow-y: auto;
            overflow-x: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 18px;
            font-weight: 500;
            line-height: 155%;
            color: #000;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 4px;
            padding: 12px;
            scroll-behavior: smooth;
        `;

        // Hide scrollbar but keep functionality
        const styleTag = document.createElement('style');
        styleTag.textContent = `
            .ew-captions-text::-webkit-scrollbar {
                display: none;
            }
            .ew-captions-text {
                -ms-overflow-style: none;
                scrollbar-width: none;
            }
        `;
        captions.appendChild(styleTag);

        this.container.appendChild(captions);
        return captions;
    }

    private createFadeOverlay(): void {
        // Top gradient fade
        const fadeOverlay = document.createElement('div');
        fadeOverlay.className = 'ew-captions-fade-top';
        fadeOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 40px;
            background: linear-gradient(180deg, #ffffff 0%, transparent 100%);
            pointer-events: none;
            z-index: 1;
        `;
        this.container.appendChild(fadeOverlay);
    }

    /**
     * Show captions with word-by-word animation
     */
    public async showText(text: string, animated: boolean = true): Promise<void> {
        if (!text || text === this.currentText) return;

        this.currentText = text;
        this.clear();

        if (!animated) {
            // Show all at once
            const textSpan = document.createElement('span');
            textSpan.textContent = text;
            textSpan.style.opacity = '1';
            this.captionsElement.appendChild(textSpan);
            this.autoScroll();
            return;
        }

        // Animate word by word
        const words = text.split(' ');
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordSpan = document.createElement('span');
            wordSpan.textContent = word + ' ';
            wordSpan.style.cssText = `
                opacity: 0;
                transition: opacity 0.4s ease;
                display: inline;
            `;

            this.captionsElement.appendChild(wordSpan);
            this.currentWords.push(wordSpan);

            // Trigger animation
            setTimeout(() => {
                wordSpan.style.opacity = '1';
            }, 10);

            // Auto-scroll as words appear
            this.autoScroll();

            // Wait before next word
            if (i < words.length - 1) {
                await this.sleep(this.animationInterval);
            }
        }
    }

    /**
     * Append new text without clearing existing
     */
    public async appendText(text: string): Promise<void> {
        if (!text) return;

        this.currentText += ' ' + text;
        const words = text.split(' ');

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordSpan = document.createElement('span');
            wordSpan.textContent = word + ' ';
            wordSpan.style.cssText = `
                opacity: 0;
                transition: opacity 0.4s ease;
                display: inline;
            `;

            this.captionsElement.appendChild(wordSpan);
            this.currentWords.push(wordSpan);

            setTimeout(() => {
                wordSpan.style.opacity = '1';
            }, 10);

            this.autoScroll();

            if (i < words.length - 1) {
                await this.sleep(this.animationInterval);
            }
        }
    }

    /**
     * Clear all captions
     */
    public clear(): void {
        this.captionsElement.innerHTML = '';
        this.currentWords = [];
        this.currentText = '';

        // Re-add style tag
        const styleTag = document.createElement('style');
        styleTag.textContent = `
            .ew-captions-text::-webkit-scrollbar {
                display: none;
            }
            .ew-captions-text {
                -ms-overflow-style: none;
                scrollbar-width: none;
            }
        `;
        this.captionsElement.appendChild(styleTag);
    }

    /**
     * Auto-scroll to bottom
     */
    private autoScroll(): void {
        this.captionsElement.scrollTop = this.captionsElement.scrollHeight;
    }

    /**
     * Show/hide overlay
     */
    public show(): void {
        this.container.style.display = 'block';
    }

    public hide(): void {
        this.container.style.display = 'none';
        this.clear();
    }

    /**
     * Set animation speed
     */
    public setAnimationInterval(ms: number): void {
        this.animationInterval = ms;
    }

    /**
     * Utility: Sleep for async/await
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup
     */
    public destroy(): void {
        this.container.remove();
    }
}
