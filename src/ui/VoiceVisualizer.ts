/**
 * Voice Visualizer Component
 * 6-bar animated sound wave visualization inspired by voice-code design
 */
export class VoiceVisualizer {
    private container: HTMLElement;
    private visualizerElement: HTMLElement;
    private bars: HTMLElement[] = [];
    private isPlaying: boolean = false;
    private animationSpeed: number = 1; // Speed multiplier

    constructor(parent: HTMLElement) {
        this.container = this.createContainer();
        this.visualizerElement = this.createVisualizer();
        this.createBars();
        this.createFadeOverlays();
        parent.appendChild(this.container);
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'ew-voice-visualizer-container';
        container.style.cssText = `
            position: relative;
            width: 120px;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        `;
        return container;
    }

    private createVisualizer(): HTMLElement {
        const visualizer = document.createElement('div');
        visualizer.className = 'ew-voice-visualizer';
        visualizer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            height: 100%;
            transform: skew(-20deg);
        `;
        this.container.appendChild(visualizer);
        return visualizer;
    }

    private createBars(): void {
        // Create 6 vertical bars
        for (let i = 0; i < 6; i++) {
            const bar = document.createElement('div');
            bar.className = `ew-voice-bar ew-voice-bar-${i}`;
            bar.style.cssText = `
                width: 8px;
                height: 20px;
                background: #ff0d40;
                border-radius: 4px;
                transition: height 0.1s ease;
            `;
            this.bars.push(bar);
            this.visualizerElement.appendChild(bar);
        }
    }

    private createFadeOverlays(): void {
        // Create fade overlays on all 4 sides (30% fade)
        const overlays = [
            { position: 'top', gradient: 'linear-gradient(180deg, #ffffff 0%, transparent 100%)' },
            { position: 'bottom', gradient: 'linear-gradient(0deg, #ffffff 0%, transparent 100%)' },
            { position: 'left', gradient: 'linear-gradient(90deg, #ffffff 0%, transparent 100%)' },
            { position: 'right', gradient: 'linear-gradient(270deg, #ffffff 0%, transparent 100%)' }
        ];

        overlays.forEach(({ position, gradient }) => {
            const overlay = document.createElement('div');
            overlay.className = `ew-voice-fade-${position}`;

            const styles: any = {
                position: 'absolute',
                background: gradient,
                pointerEvents: 'none',
                opacity: '0.3'
            };

            if (position === 'top' || position === 'bottom') {
                styles.width = '100%';
                styles.height = '20%';
                styles[position] = '0';
                styles.left = '0';
            } else {
                styles.height = '100%';
                styles.width = '20%';
                styles[position] = '0';
                styles.top = '0';
            }

            overlay.style.cssText = Object.entries(styles)
                .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`)
                .join('; ');

            this.container.appendChild(overlay);
        });
    }

    /**
     * Start playing animation
     */
    public play(): void {
        if (this.isPlaying) return;
        this.isPlaying = true;

        // Add filled style
        this.bars.forEach(bar => {
            bar.style.background = '#ff0d40';
            bar.style.border = 'none';
        });

        // Start animation
        this.animateBars();
    }

    /**
     * Pause animation (show hollow bars)
     */
    public pause(): void {
        this.isPlaying = false;

        // Change to hollow style
        this.bars.forEach(bar => {
            bar.style.background = 'transparent';
            bar.style.border = '2px solid #ff0d40';
            bar.style.height = '20px'; // Reset to base height
        });
    }

    /**
     * Animate bars with barLoader keyframe pattern
     * Replicates the voice-code barLoader animation
     */
    private animateBars(): void {
        if (!this.isPlaying) return;

        // Bar heights for each keyframe (6 bars, 10 keyframes)
        const keyframes = [
            [20, 40, 60, 40, 20, 30], // 0%
            [40, 60, 80, 60, 40, 50], // 10%
            [30, 50, 70, 50, 30, 40], // 20%
            [50, 70, 90, 70, 50, 60], // 30%
            [20, 40, 60, 40, 20, 30], // 40%
            [40, 60, 80, 60, 40, 50], // 50%
            [30, 50, 70, 50, 30, 40], // 60%
            [50, 70, 90, 70, 50, 60], // 70%
            [20, 40, 60, 40, 20, 30], // 80%
            [30, 50, 70, 50, 30, 40], // 90%
        ];

        let currentFrame = 0;
        const frameDuration = (2000 / this.animationSpeed) / keyframes.length;

        const animate = () => {
            if (!this.isPlaying) return;

            const heights = keyframes[currentFrame];
            this.bars.forEach((bar, index) => {
                bar.style.height = `${heights[index]}px`;
            });

            currentFrame = (currentFrame + 1) % keyframes.length;
            setTimeout(() => requestAnimationFrame(animate), frameDuration);
        };

        animate();
    }

    /**
     * Set animation speed
     */
    public setSpeed(speed: number): void {
        this.animationSpeed = speed;
    }

    /**
     * Show/hide visualizer
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
        this.isPlaying = false;
        this.container.remove();
    }
}
