import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not found. Please ensure it is set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY! });
const TTS_MODEL = "gemini-2.5-pro-preview-tts"; // Dedicated TTS model

type StatusUpdateCallback = (message: string) => void;

export interface SpeechConfig {
  speakingRate: number;
  pitch: number;
  volumeGainDb: number;
}

/**
 * A helper function to retry an async function multiple times with exponential backoff.
 * @param fn The async function to retry.
 * @param onRetry A callback function that gets called on each retry.
 * @param retries The maximum number of retries.
 * @param delayMs The initial delay between retries.
 * @returns The result of the async function.
 */
async function withRetries<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number, error: Error) => void,
  retries = 3,
  delayMs = 1500
): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < retries - 1) {
        onRetry(i + 1, lastError);
        // Exponential backoff
        await new Promise(res => setTimeout(res, delayMs * Math.pow(2, i)));
      }
    }
  }
  throw new Error(`All ${retries} attempts failed. Last error: ${lastError?.message}`);
}

/**
 * Generates audio for a single text segment using the Gemini TTS model.
 * It optionally includes the previous text segment to provide conversational context,
 * improving the consistency of intonation and prosody between segments.
 * @param text The text to convert to speech.
 * @param previousSegmentText The text of the preceding segment for context.
 * @param voiceName The name of the prebuilt voice to use.
 * @param speechParams An object containing speakingRate, pitch, and volumeGainDb.
 * @param onStatusUpdate A callback for status updates.
 * @returns A promise that resolves to a Uint8Array of raw PCM audio data.
 */
export const generateAudioForSegment = async (
  text: string,
  previousSegmentText: string | undefined,
  voiceName: string,
  speechParams: SpeechConfig,
  onStatusUpdate: StatusUpdateCallback
): Promise<Uint8Array> => {
  if (!API_KEY) throw new Error("API Key not configured for TTS.");
  if (!text.trim()) return new Uint8Array(0);

  onStatusUpdate(`Generating audio for segment...`);
  
  try {
    const speechConfig = {
      voiceConfig: { 
        prebuiltVoiceConfig: { 
            voiceName,
            speakingRate: speechParams.speakingRate,
            pitch: speechParams.pitch,
            volumeGainDb: speechParams.volumeGainDb,
        } 
      }
    };
      
    // Construct content parts. If previous text exists, add it first for context.
    // The API will process both but we will only use the audio for the current text.
    const contentParts = [];
    if (previousSegmentText && previousSegmentText.trim()) {
      contentParts.push({ text: previousSegmentText });
    }
    contentParts.push({ text: text });

    const apiCall = () => ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: contentParts }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: speechConfig,
      },
    });

    const response: GenerateContentResponse = await withRetries(apiCall, (attempt, error) => {
        onStatusUpdate(`Audio generation failed (attempt ${attempt}). Retrying...`);
        console.warn(`Attempt ${attempt} for TTS generation failed:`, error.message);
    });
    
    // If context was provided, the audio we want is the LAST part in the response array.
    const allAudioParts = response.candidates?.[0]?.content?.parts;
    const audioPart = allAudioParts && allAudioParts.length > 0
      ? allAudioParts[allAudioParts.length - 1]
      : undefined;

    if (audioPart && 'inlineData' in audioPart && audioPart.inlineData?.data) {
      onStatusUpdate(`Success! Audio segment generated.`);
      const binaryString = atob(audioPart.inlineData.data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    } else {
      const finishReason = response.candidates?.[0]?.finishReason || 'Unknown';
      const safetyRatings = response.candidates?.[0]?.safetyRatings;
      let reason = `Reason: ${finishReason}.`;
      if (safetyRatings) {
        reason += ` Safety Ratings: ${JSON.stringify(safetyRatings)}`;
      }
      const errorMessage = `No audio data was generated. This could be due to content safety filters or an API error. ${reason}`;
      throw new Error(errorMessage);
    }

  } catch (error) {
    const lastError = error instanceof Error ? error : new Error(String(error));
    console.error(`Audio segment generation failed permanently:`, lastError.message);
    onStatusUpdate(`❌ Audio generation failed: ${lastError.message}`);
    throw lastError;
  }
};
