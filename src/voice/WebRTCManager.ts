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
    private audioElement: HTMLAudioElement | null = null;

    constructor(config: PluginConfig, connection: ConnectionAdapter) {
        super();
        this.config = config;
        this.connection = connection;
    }

    public async initialize(): Promise<void> {
        try {
            console.log('🎤 WebRTC Manager: Starting initialization...');
            
            // Get ephemeral key from server
            console.log('🔑 WebRTC Manager: Getting ephemeral key from server...');
            this.session = await this.getEphemeralKey();
            console.log('✅ WebRTC Manager: Received session data:', {
                model: this.session.model,
                voice: this.session.voice,
                hasKey: !!this.session.client_secret?.value,
                expiresAt: this.session.client_secret?.expires_at,
                toolsCount: this.session.tools?.length || 0,
                fullSession: this.session
            });
            
            // Setup WebRTC connection
            console.log('🔌 WebRTC Manager: Setting up WebRTC connection...');
            await this.setupWebRTC();
            
            // Initialize audio context
            console.log('🔊 WebRTC Manager: Initializing audio context...');
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.audioPlayer = new AudioPlayer(this.audioContext);
            
            console.log('🎉 WebRTC Manager: Initialization complete!');
        } catch (error) {
            console.error('❌ WebRTC Manager: Failed to initialize:', error);
            console.error('Error stack:', (error as Error).stack);
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
            console.error('❌ No session available for WebRTC setup');
            throw new Error('No session available');
        }

        console.log('📡 Creating RTCPeerConnection...');
        // Create peer connection
        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        // Add connection state change handler
        this.pc.onconnectionstatechange = () => {
            console.log('🔄 RTCPeerConnection state:', this.pc?.connectionState);
        };

        this.pc.oniceconnectionstatechange = () => {
            console.log('🧊 ICE connection state:', this.pc?.iceConnectionState);
        };

        console.log('📢 Creating data channel "oai-events"...');
        // Setup data channel for events
        this.dataChannel = this.pc.createDataChannel('oai-events', {
            ordered: true
        });

        this.setupDataChannelHandlers();

        console.log('🎙️ Adding audio transceiver...');
        // Get user media FIRST to ensure microphone permission
        console.log('🎙️ Requesting microphone access...');
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 24000
                }
            });
            console.log('✅ Microphone access granted, adding track to peer connection');
            
            // Add local audio track to peer connection
            this.mediaStream.getTracks().forEach(track => {
                console.log(`➕ Adding track: ${track.label}`);
                if (this.pc && this.mediaStream) {
                    this.pc.addTrack(track, this.mediaStream);
                }
            });
        } catch (error) {
            console.error('❌ Failed to get microphone access:', error);
            console.warn('⚠️ Continuing without microphone - text only mode');
        }
        
        // Add audio transceiver
        this.pc.addTransceiver('audio', { direction: 'sendrecv' });

        // Handle remote audio tracks
        this.pc.ontrack = (event) => {
            console.log('🎧 Received remote audio track:', event);
            if (!this.audioElement) {
                this.audioElement = document.createElement('audio');
                this.audioElement.autoplay = true;
                console.log('🔊 Created audio element for playback');
            }
            this.audioElement.srcObject = event.streams[0];
            console.log('🎵 Audio element configured with stream');
        };

        console.log('📝 Creating offer...');
        // Create and set local description
        const offer = await this.pc.createOffer();
        console.log('📤 Setting local description...');
        await this.pc.setLocalDescription(offer);

        console.log('🌐 Connecting to OpenAI Realtime API...');
        // Get answer from OpenAI
        const answer = await this.connectToOpenAI(offer);
        console.log('📥 Setting remote description...');
        await this.pc.setRemoteDescription(answer);

        console.log('⏳ Waiting for connection to establish...');
        // Wait for connection
        await this.waitForConnection();
        console.log('✅ WebRTC connection established!');
    }

    private setupDataChannelHandlers(): void {
        if (!this.dataChannel) {
            console.error('❌ No data channel to setup handlers');
            return;
        }

        this.dataChannel.onopen = () => {
            console.log('✅ Data channel opened! State:', this.dataChannel?.readyState);
            console.log('⏸️ Waiting for session.created event before sending configuration...');
            // Don't send session update immediately - wait for session.created event
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('📨 Received event:', data.type, data);
                this.handleRealtimeEvent(data);
            } catch (error) {
                console.error('❌ Failed to parse realtime event:', error);
                console.error('Raw data:', event.data);
            }
        };

        this.dataChannel.onerror = (error) => {
            console.error('❌ Data channel error:', error);
            this.emit('error', error);
        };

        this.dataChannel.onclose = () => {
            console.log('🔌 Data channel closed');
        };

        // Log initial state
        console.log('📊 Data channel initial state:', this.dataChannel.readyState);
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
            console.log('⏱️ Starting connection timeout (30s)...');
            const timeout = setTimeout(() => {
                console.error('❌ Connection timeout after 30 seconds');
                reject(new Error('WebRTC connection timeout'));
            }, 30000);

            const checkConnection = () => {
                const state = this.pc?.connectionState;
                console.log('🔍 Checking connection state:', state);
                
                if (state === 'connected') {
                    clearTimeout(timeout);
                    console.log('✅ Connection established!');
                    resolve();
                } else if (state === 'failed') {
                    clearTimeout(timeout);
                    console.error('❌ Connection failed!');
                    reject(new Error('WebRTC connection failed'));
                } else {
                    setTimeout(checkConnection, 100);
                }
            };

            checkConnection();
        });
    }

    private sendSessionUpdate(): void {
        if (!this.session || !this.dataChannel) {
            console.error('❌ Cannot send session update - missing session or data channel');
            return;
        }

        if (this.dataChannel.readyState !== 'open') {
            console.error('❌ Cannot send session update - data channel not open. State:', this.dataChannel.readyState);
            return;
        }

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

        console.log('📤 Sending session update:', sessionConfig);
        this.sendEvent(sessionConfig);
        console.log('✅ Session update sent!');
    }

    private sendEvent(event: RealtimeEvent): void {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            const eventStr = JSON.stringify(event);
            console.log(`📮 Sending event type: ${event.type}, size: ${eventStr.length} bytes`);
            this.dataChannel.send(eventStr);
        } else {
            console.error('❌ Cannot send event - data channel not ready. State:', this.dataChannel?.readyState);
        }
    }

    private handleRealtimeEvent(event: RealtimeEvent): void {
        console.log(`🎯 Handling event: ${event.type}`);
        
        switch (event.type) {
            case 'session.created':
                console.log('🎉 Session created successfully:', event);
                // NOW send the session configuration
                console.log('📤 Sending session configuration...');
                this.sendSessionUpdate();
                break;
                
            case 'session.updated':
                console.log('✅ Session updated successfully:', event);
                break;

            case 'input_audio_buffer.speech_started':
                console.log('🎤 Speech started detected');
                this.emit('speech:start');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('🔇 Speech stopped detected');
                this.emit('speech:end');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                console.log('📢 Transcription completed:', event.transcript);
                this.emit('transcription', event.transcript, true);
                // Also emit as a message for chat history
                if (event.transcript) {
                    this.emit('message', {
                        type: 'user',
                        content: event.transcript,
                        source: 'voice'
                    });
                }
                break;

            case 'conversation.item.input_audio_transcription.in_progress':
                console.log('📝 Transcription in progress:', event.transcript);
                this.emit('transcription', event.transcript, false);
                break;
                
            case 'conversation.item.created':
                console.log('💬 Conversation item created:', event);
                break;

            case 'response.created':
                console.log('🎬 Response creation started');
                break;
                
            case 'response.text.delta':
                // Accumulate text deltas for complete message
                console.log('✍️ Text delta received:', event.delta);
                this.emit('text:delta', event.delta);
                break;
            
            case 'response.text.done':
                // Complete text response
                console.log('✅ Response text complete:', event.text);
                if (event.text) {
                    this.emit('message', {
                        type: 'assistant',
                        content: event.text,
                        source: 'voice'
                    });
                    this.emit('response:complete', event.text);
                }
                break;
                
            case 'response.done':
                console.log('🎆 Response fully complete');
                this.emit('response:complete', '');
                break;

            case 'response.audio.delta':
                if (event.delta) {
                    console.log('🎵 Audio delta received, size:', event.delta.length);
                    const audioData = this.base64ToArrayBuffer(event.delta);
                    this.handleAudioOutput(audioData);
                }
                break;
                
            case 'response.audio.done':
                console.log('🎶 Audio response complete');
                break;

            case 'response.audio_transcript.done':
                console.log('🎙️ Assistant audio transcript:', event.transcript);
                if (event.transcript) {
                    this.emit('message', {
                        type: 'assistant',
                        content: event.transcript,
                        source: 'voice'
                    });
                }
                break;

            case 'response.function_call_arguments.done':
                console.log('🔧 Tool call arguments complete:', event);
                this.handleToolCall(event);
                break;

            case 'error':
                console.error('❌ Realtime API error:', event.error);
                this.emit('error', new Error(event.error?.message || 'Realtime error'));
                break;

            default:
                console.warn('⚠️ Unhandled realtime event:', event.type, event);
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
        console.log('🎤 Starting recording...');
        if (this.isRecording) {
            console.log('⚠️ Already recording, skipping');
            return;
        }

        try {
            console.log('🎙️ Requesting microphone access...');
            // Get user media
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 24000
                }
            });
            console.log('✅ Microphone access granted');

            // Add tracks to peer connection
            if (this.pc && this.mediaStream) {
                const audioTrack = this.mediaStream.getAudioTracks()[0];
                console.log('🎵 Audio track obtained:', audioTrack.label);
                
                const sender = this.pc.getSenders().find(s => s.track?.kind === 'audio');
                
                if (sender) {
                    console.log('🔄 Replacing existing audio track');
                    sender.replaceTrack(audioTrack);
                } else {
                    console.log('➕ Adding new audio track to peer connection');
                    this.pc.addTrack(audioTrack, this.mediaStream);
                }
            }

            this.isRecording = true;
            console.log('🔴 Recording started!');
            this.emit('recording:start');
        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            throw error;
        }
    }

    public stopRecording(): void {
        console.log('🔇 Stopping recording...');
        if (!this.isRecording) {
            console.log('⚠️ Not recording, skipping');
            return;
        }

        // Stop media tracks
        if (this.mediaStream) {
            console.log('🛑 Stopping media tracks...');
            this.mediaStream.getTracks().forEach(track => {
                console.log(`🛑 Stopping track: ${track.label}`);
                track.stop();
            });
            this.mediaStream = null;
        }

        // Remove tracks from peer connection
        if (this.pc) {
            const sender = this.pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender && sender.track) {
                console.log('🔄 Removing audio track from peer connection');
                sender.replaceTrack(null);
            }
        }

        this.isRecording = false;
        console.log('⏹️ Recording stopped');
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
        console.log('💬 Sending text message:', text);
        
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            console.error('❌ Cannot send text - data channel not open. State:', this.dataChannel?.readyState);
            throw new Error('Data channel not ready for sending messages');
        }
        
        const conversationEvent = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text
                }]
            }
        };
        
        console.log('📤 Sending conversation.item.create event');
        this.sendEvent(conversationEvent);

        // Trigger response
        console.log('🎬 Triggering response.create');
        this.sendEvent({
            type: 'response.create'
        });
        
        console.log('✅ Text message sent successfully');
    }

    public cleanup(): void {
        console.log('🧹 Cleaning up WebRTC Manager...');
        
        this.stopRecording();

        if (this.dataChannel) {
            console.log('🔌 Closing data channel...');
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.pc) {
            console.log('📡 Closing peer connection...');
            this.pc.close();
            this.pc = null;
        }

        if (this.audioContext) {
            console.log('🔊 Closing audio context...');
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.audioPlayer) {
            console.log('🎵 Cleaning up audio player...');
            this.audioPlayer.cleanup();
            this.audioPlayer = null;
        }
        
        if (this.audioElement) {
            console.log('🔊 Removing audio element...');
            this.audioElement.srcObject = null;
            this.audioElement = null;
        }

        this.session = null;
        this.audioQueue = [];
        console.log('✅ Cleanup complete');
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