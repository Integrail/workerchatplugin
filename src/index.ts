export { EverworkerVoicePlugin } from './core/EverworkerVoicePlugin';
export * from './types';

// For CDN usage
import { EverworkerVoicePlugin } from './core/EverworkerVoicePlugin';
import { PluginConfig } from './types';

// Make it available globally for CDN usage
if (typeof window !== 'undefined') {
    (window as any).EverworkerVoice = {
        init: (config: PluginConfig) => {
            const instance = new EverworkerVoicePlugin(config);
            if (!(window as any).EverworkerVoice.instances) {
                (window as any).EverworkerVoice.instances = new Map();
            }
            (window as any).EverworkerVoice.instances.set(config.workerId, instance);
            return instance;
        },
        instances: new Map(),
        Plugin: EverworkerVoicePlugin
    };
}