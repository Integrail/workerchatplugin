export class EventEmitter {
    private events: Map<string, Set<Function>> = new Map();

    public on(event: string, handler: Function): void {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event)!.add(handler);
    }

    public off(event: string, handler: Function): void {
        const handlers = this.events.get(event);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.events.delete(event);
            }
        }
    }

    public once(event: string, handler: Function): void {
        const onceHandler = (...args: any[]) => {
            handler(...args);
            this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
    }

    protected emit(event: string, ...args: any[]): void {
        const handlers = this.events.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(...args);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    protected removeAllListeners(event?: string): void {
        if (event) {
            this.events.delete(event);
        } else {
            this.events.clear();
        }
    }

    public listenerCount(event: string): number {
        const handlers = this.events.get(event);
        return handlers ? handlers.size : 0;
    }

    public eventNames(): string[] {
        return Array.from(this.events.keys());
    }
}