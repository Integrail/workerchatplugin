console.log('🚀 Everworker Voice Plugin: Loading module...');

export { EverworkerVoicePlugin } from './core/EverworkerVoicePlugin';
export * from './types';

// For CDN usage
import { EverworkerVoicePlugin } from './core/EverworkerVoicePlugin';
import { PluginConfig } from './types';

console.log('📦 Everworker Voice Plugin: Setting up global object...');

// Make it available globally for CDN usage
if (typeof window !== 'undefined') {
    console.log('🌐 Everworker Voice Plugin: Window detected, creating global instance');
    (window as any).EverworkerVoice = {
        init: (config: PluginConfig) => {
            console.log('🎯 EverworkerVoice.init called with config:', config);
            try {
                const instance = new EverworkerVoicePlugin(config);
                if (!(window as any).EverworkerVoice.instances) {
                    (window as any).EverworkerVoice.instances = new Map();
                }
                (window as any).EverworkerVoice.instances.set(config.workerId, instance);
                console.log('✅ Plugin instance created successfully');
                return instance;
            } catch (error) {
                console.error('❌ Failed to create plugin instance:', error);
                throw error;
            }
        },
        instances: new Map(),
        Plugin: EverworkerVoicePlugin
    };
    console.log('✅ Global EverworkerVoice object created');
} else {
    console.log('⚠️ No window object detected (SSR or Node environment)');
}

console.log('✅ Everworker Voice Plugin: Module loaded successfully');