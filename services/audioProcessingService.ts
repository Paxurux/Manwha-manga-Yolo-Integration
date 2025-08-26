/**
 * Creates an audio processor instance tied to a specific AudioContext.
 * @param audioContext The Web Audio API AudioContext.
 */
export const createAudioProcessor = (audioContext: AudioContext) => {

  /**
   * Decodes raw PCM audio data from the TTS API into a processable AudioBuffer.
   */
  const decodePcmToAudioBuffer = async (pcmData: Uint8Array): Promise<AudioBuffer> => {
    // The API returns 16-bit PCM data.
    const pcm16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);
    // We need to convert it to 32-bit float for the Web Audio API.
    const pcm32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      pcm32[i] = pcm16[i] / 32768.0; // Normalize to [-1.0, 1.0]
    }
    // Create an AudioBuffer. The API sample rate is 24000.
    const buffer = audioContext.createBuffer(1, pcm32.length, 24000);
    buffer.copyToChannel(pcm32, 0);
    return buffer;
  };

  /**
   * Adjusts the speed of an audio buffer to fit a target duration using an OfflineAudioContext.
   * This technique resamples the audio, which changes the speed WITHOUT altering the pitch,
   * preserving the natural tone of the voice.
   */
  const adjustAudioSpeed = async (sourceBuffer: AudioBuffer, targetDuration: number): Promise<AudioBuffer> => {
    if (Math.abs(sourceBuffer.duration - targetDuration) < 0.1) {
        return sourceBuffer; // No significant change needed
    }

    const offlineCtx = new OfflineAudioContext(
      sourceBuffer.numberOfChannels,
      Math.ceil(targetDuration * audioContext.sampleRate), // Target length in samples
      audioContext.sampleRate
    );

    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = sourceBuffer;
    
    // The magic: playbackRate stretches or compresses the audio to fit the new duration.
    sourceNode.playbackRate.value = sourceBuffer.duration / targetDuration;
    
    sourceNode.connect(offlineCtx.destination);
    sourceNode.start();

    return offlineCtx.startRendering();
  };

  /**
   * Combines multiple AudioBuffers into a single, continuous AudioBuffer.
   */
  const combineAudioBuffers = (buffers: AudioBuffer[]): AudioBuffer => {
    if (buffers.length === 0) {
        // Create an empty buffer if there's nothing to combine
        return audioContext.createBuffer(1, 1, audioContext.sampleRate);
    }
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const combinedBuffer = audioContext.createBuffer(1, totalLength, audioContext.sampleRate);
    const channelData = combinedBuffer.getChannelData(0);

    let offset = 0;
    for (const buffer of buffers) {
      channelData.set(buffer.getChannelData(0), offset);
      offset += buffer.length;
    }
    return combinedBuffer;
  };
  
  // Helper for writing WAV header
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  /**
   * Converts a final AudioBuffer into a Blob representing a WAV file.
   */
  const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
    const pcmData = buffer.getChannelData(0);
    const wavBuffer = new ArrayBuffer(44 + pcmData.length * 2);
    const view = new DataView(wavBuffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length * 2, true);
    writeString(view, 8, 'WAVE');
    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true); // byteRate
    view.setUint16(32, 2, true); // blockAlign
    view.setUint16(34, 16, true); // bitsPerSample
    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length * 2, true);
    
    // Write PCM data
    for (let i = 0; i < pcmData.length; i++) {
        const s = Math.max(-1, Math.min(1, pcmData[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  };
  
  /**
    * Converts a Blob to a base64 string for persistence.
  */
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result ? result.split(',')[1] : '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
  };

  return {
    decodePcmToAudioBuffer,
    adjustAudioSpeed,
    combineAudioBuffers,
    audioBufferToWavBlob,
    blobToBase64,
  };
};
