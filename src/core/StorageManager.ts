import { Message } from '../types';

export class StorageManager {
    private storageType: 'none' | 'session' | 'local';
    private storageKey = 'everworker-voice-messages';

    constructor(storageType: 'none' | 'session' | 'local') {
        this.storageType = storageType;
    }

    public async loadMessages(): Promise<Message[]> {
        if (this.storageType === 'none') {
            return [];
        }

        try {
            const storage = this.getStorage();
            const data = storage.getItem(this.storageKey);
            
            if (!data) {
                return [];
            }

            const messages = JSON.parse(data);
            // Convert timestamps back to Date objects
            return messages.map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
            }));
        } catch (error) {
            console.error('Failed to load messages from storage:', error);
            return [];
        }
    }

    public async saveMessages(messages: Message[]): Promise<void> {
        if (this.storageType === 'none') {
            return;
        }

        try {
            const storage = this.getStorage();
            // Limit stored messages to last 100
            const messagesToStore = messages.slice(-100);
            storage.setItem(this.storageKey, JSON.stringify(messagesToStore));
        } catch (error) {
            console.error('Failed to save messages to storage:', error);
            // Handle quota exceeded or other storage errors
            if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                this.clearMessages();
            }
        }
    }

    public clearMessages(): void {
        if (this.storageType === 'none') {
            return;
        }

        try {
            const storage = this.getStorage();
            storage.removeItem(this.storageKey);
        } catch (error) {
            console.error('Failed to clear messages from storage:', error);
        }
    }

    private getStorage(): Storage {
        if (this.storageType === 'session') {
            return window.sessionStorage;
        } else {
            return window.localStorage;
        }
    }

    // Additional storage utilities
    public saveConfig(key: string, value: any): void {
        if (this.storageType === 'none') {
            return;
        }

        try {
            const storage = this.getStorage();
            storage.setItem(`everworker-voice-${key}`, JSON.stringify(value));
        } catch (error) {
            console.error(`Failed to save ${key} to storage:`, error);
        }
    }

    public loadConfig(key: string): any {
        if (this.storageType === 'none') {
            return null;
        }

        try {
            const storage = this.getStorage();
            const data = storage.getItem(`everworker-voice-${key}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error(`Failed to load ${key} from storage:`, error);
            return null;
        }
    }
}