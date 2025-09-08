import { EventEmitter } from '../core/EventEmitter';
import { PluginConfig, ConnectionAdapter, VoiceSession, RealtimeEvent, AudioConfig } from '../types';

/**
 * WebRTC Manager for OpenAI Realtime API voice communication
 * Based on the Everworker voice implementation
 */
export class WebRTCManager extends EventEmitter {
    private config: PluginConfig;
    private connection: ConnectionAdapter;
    private pc: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private mediaStream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private session: VoiceSession | null = null;
    private isRecording = false;
    private audioQueue: ArrayBuffer[] = [];
    private audioPlayer: AudioPlayer | null = null;

    constructor(config: PluginConfig, connection: ConnectionAdapter) {
        super();
        this.config = config;
        this.connection = connection;
    }

    public async initialize(): Promise<void> {
        try {
            console.log('WebRTC Manager: Starting initialization...');
            
            // Get ephemeral key from server
            console.log('WebRTC Manager: Getting ephemeral key from server...');
            this.session = await this.getEphemeralKey();
            console.log('WebRTC Manager: Received session data:', {
                model: this.session.model,
                voice: this.session.voice,
                hasKey: !!this.session.client_secret?.value,
                expiresAt: this.session.client_secret?.expires_at,
                toolsCount: this.session.tools?.length || 0
            });
            
            // Setup WebRTC connection
            console.log('WebRTC Manager: Setting up WebRTC connection...');
            await this.setupWebRTC();
            
            // Initialize audio context
            console.log('WebRTC Manager: Initializing audio context...');
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.audioPlayer = new AudioPlayer(this.audioContext);
            
            console.log('WebRTC Manager: Initialization complete!');
        } catch (error) {
            console.error('WebRTC Manager: Failed to initialize:', error);
            throw error;
        }
    }

    private async getEphemeralKey(): Promise<VoiceSession> {
        if ('getEphemeralKey' in this.connection) {
            return (this.connection as any).getEphemeralKey();
        }
        throw new Error('Connection adapter does not support voice');
    }

    private async setupWebRTC(): Promise<void> {
        if (!this.session) {
            throw new Error('No session available');
        }

        // Create peer connection
        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        // Setup data channel for events
        this.dataChannel = this.pc.createDataChannel('oai-events', {
            ordered: true
        });

        this.setupDataChannelHandlers();

        // Add audio transceiver
        this.pc.addTransceiver('audio', { direction: 'sendrecv' });

        // Create and set local description
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        // Get answer from OpenAI
        const answer = await this.connectToOpenAI(offer);
        await this.pc.setRemoteDescription(answer);

        // Wait for connection
        await this.waitForConnection();
    }

    private setupDataChannelHandlers(): void {
        if (!this.dataChannel) return;

        this.dataChannel.onopen = () => {
            console.log('WebRTC data channel opened');
            this.sendSessionUpdate();
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleRealtimeEvent(data);
            } catch (error) {
                console.error('Failed to parse realtime event:', error);
            }
        };

        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
            this.emit('error', error);
        };

        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
        };
    }

    private async connectToOpenAI(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        if (!this.session) {
            throw new Error('No session available');
        }

        const baseUrl = 'https://api.openai.com/v1/realtime';
        const model = this.session.model;
        
        const response = await fetch(`${baseUrl}?model=${model}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.session.client_secret.value}`,
                'Content-Type': 'application/sdp'
            },
            body: offer.sdp
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI Realtime API error:', response.status, errorText);
            throw new Error(`Failed to connect to OpenAI: ${response.status} ${response.statusText}`);
        }

        const answerSdp = await response.text();
        
        return {
            type: 'answer',
            sdp: answerSdp
        };
    }

    private async waitForConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('WebRTC connection timeout'));
            }, 30000);

            const checkConnection = () => {
                if (this.pc?.connectionState === 'connected') {
                    clearTimeout(timeout);
                    resolve();
                } else if (this.pc?.connectionState === 'failed') {
                    clearTimeout(timeout);
                    reject(new Error('WebRTC connection failed'));
                } else {
                    setTimeout(checkConnection, 100);
                }
            };

            checkConnection();
        });
    }

    private sendSessionUpdate(): void {
        if (!this.session || !this.dataChannel) return;

        const sessionConfig: RealtimeEvent = {
            type: 'session.update',
            session: {
                model: this.session.model,
                voice: this.session.voice,
                instructions: this.session.instructions,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 200
                },
                tools: this.session.tools || []
            }
        };

        console.log('Sending session update:', sessionConfig);
        this.sendEvent(sessionConfig);
    }

    private sendEvent(event: RealtimeEvent): void {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(event));
        }
    }

    private handleRealtimeEvent(event: RealtimeEvent): void {
        switch (event.type) {
            case 'session.created':
            case 'session.updated':
                console.log('Session updated:', event);
                break;

            case 'input_audio_buffer.speech_started':
                this.emit('speech:start');
                break;

            case 'input_audio_buffer.speech_stopped':
                this.emit('speech:end');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                this.emit('transcription', event.transcript, true);
                break;

            case 'conversation.item.input_audio_transcription.in_progress':
                this.emit('transcription', event.transcript, false);
                break;

            case 'response.text.delta':
                // Accumulate text deltas for complete message
                this.emit('text:delta', event.delta);
                break;
            
            case 'response.text.done':
                // Complete text response
                if (event.text) {
                    this.emit('message', {
                        type: 'assistant',
                        content: event.text,
                        source: 'voice'
                    });
                }
                break;

            case 'response.audio.delta':
                if (event.delta) {
                    const audioData = this.base64ToArrayBuffer(event.delta);
                    this.handleAudioOutput(audioData);
                }
                break;

            case 'response.function_call_arguments.done':
                this.handleToolCall(event);
                break;

            case 'error':
                console.error('Realtime error:', event.error);
                this.emit('error', new Error(event.error?.message || 'Realtime error'));
                break;

            default:
                console.log('Unhandled realtime event:', event.type);
        }
    }

    private async handleToolCall(event: RealtimeEvent): Promise<void> {
        if (!event.call_id || !event.name || !event.arguments) return;

        try {
            // Process tool call through server
            const result = await (this.connection as any).processRealtimeToolCall({
                call_id: event.call_id,
                name: event.name,
                arguments: event.arguments
            });

            // Send result back
            this.sendEvent({
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: event.call_id,
                    output: JSON.stringify(result)
                }
            });
        } catch (error) {
            console.error('Tool call failed:', error);
            
            this.sendEvent({
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: event.call_id,
                    output: JSON.stringify({
                        error: error instanceof Error ? error.message : 'Tool call failed'
                    })
                }
            });
        }
    }

    public async startRecording(): Promise<void> {
        if (this.isRecording) return;

        try {
            // Get user media
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 24000
                }
            });

            // Add tracks to peer connection
            if (this.pc && this.mediaStream) {
                const audioTrack = this.mediaStream.getAudioTracks()[0];
                const sender = this.pc.getSenders().find(s => s.track?.kind === 'audio');
                
                if (sender) {
                    sender.replaceTrack(audioTrack);
                } else {
                    this.pc.addTrack(audioTrack, this.mediaStream);
                }
            }

            this.isRecording = true;
            this.emit('recording:start');
        } catch (error) {
            console.error('Failed to start recording:', error);
            throw error;
        }
    }

    public stopRecording(): void {
        if (!this.isRecording) return;

        // Stop media tracks
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Remove tracks from peer connection
        if (this.pc) {
            const sender = this.pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender && sender.track) {
                sender.replaceTrack(null);
            }
        }

        this.isRecording = false;
        this.emit('recording:stop');
    }

    private handleAudioOutput(audioData: ArrayBuffer): void {
        this.audioQueue.push(audioData);
        this.emit('audio', audioData);
        
        // Play audio if player is available
        if (this.audioPlayer) {
            this.audioPlayer.play(audioData);
        }
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        return bytes.buffer;
    }

    public sendTextMessage(text: string): void {
        this.sendEvent({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text
                }]
            }
        });

        // Trigger response
        this.sendEvent({
            type: 'response.create'
        });
    }

    public cleanup(): void {
        this.stopRecording();

        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.audioPlayer) {
            this.audioPlayer.cleanup();
            this.audioPlayer = null;
        }

        this.session = null;
        this.audioQueue = [];
    }
}

/**
 * Simple audio player for PCM16 audio output
 */
class AudioPlayer {
    private context: AudioContext;
    private nextStartTime = 0;

    constructor(context: AudioContext) {
        this.context = context;
        this.nextStartTime = context.currentTime;
    }

    public play(audioData: ArrayBuffer): void {
        // Convert PCM16 to Float32
        const pcm16 = new Int16Array(audioData);
        const float32 = new Float32Array(pcm16.length);
        
        for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768;
        }

        // Create audio buffer
        const audioBuffer = this.context.createBuffer(1, float32.length, 24000);
        audioBuffer.copyToChannel(float32, 0);

        // Create and play source
        const source = this.context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.context.destination);

        // Schedule playback
        const startTime = Math.max(this.context.currentTime, this.nextStartTime);
        source.start(startTime);
        
        // Update next start time
        this.nextStartTime = startTime + audioBuffer.duration;
    }

    public cleanup(): void {
        // Reset timing
        this.nextStartTime = 0;
    }
}