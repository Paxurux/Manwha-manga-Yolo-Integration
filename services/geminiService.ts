import { GoogleGenAI, GenerateContentResponse, Tool, Type } from "@google/genai";
import { magnatesMediaDirective } from './scriptingDirectives';
import { Scene, Segment, StitchedPageAnalysis, Panel } from '../types';
import { TRANSLATION_STYLE_GUIDES } from './translationStyleGuides';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("API_KEY environment variable not found. Please ensure it is set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY! });

const IMAGE_MODEL = "imagen-3.0-generate-002";
const TTS_MODEL = "gemini-2.5-pro-preview-tts"; // Dedicated TTS model

// --- NEW: Comprehensive list of fallback models ---
const ALL_TEXT_MODELS = [
  "gemini-2.5-flash", 
];


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
 * NEW: Advanced helper that retries an API call with a single model, and if it fails
 * permanently, cycles through a list of fallback models.
 * @param apiCallFn A function that takes a model name and returns a promise.
 * @param models An array of model names to try in order.
 * @param onAttempt A callback for status updates on each attempt.
 * @param retriesPerModel The number of times to retry a single model before failing over.
 * @returns The result of the first successful API call.
 */
async function withRetriesAndFallbacks<T>(
  apiCallFn: (model: string) => Promise<T>,
  models: string[],
  onAttempt: (message: string) => void,
  retriesPerModel = 2
): Promise<T> {
    let lastError: Error | null = null;
    for (const model of models) {
        try {
            const fn = () => apiCallFn(model);
            const onRetry = (attempt: number, error: Error) => {
                onAttempt(`[${model}] Failed (attempt ${attempt}/${retriesPerModel}). Retrying...`);
                console.warn(`Attempt ${attempt} for model ${model} failed:`, error.message);
            };
            onAttempt(`Attempting with model: ${model}...`);
            // Use the standard retry logic for the current model in the loop
            return await withRetries(fn, onRetry, retriesPerModel, 1500);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            onAttempt(`Model [${model}] failed permanently. Trying next model...`);
            console.error(`Model ${model} failed permanently. Error:`, lastError);
        }
    }
    throw new Error(`All fallback models failed. Last error on model ${models[models.length - 1]}: ${lastError?.message}`);
}


/**
 * Splits a long string of text into smaller chunks at sentence boundaries,
 * ensuring no chunk exceeds a maximum length.
 * @param text The full text to split.
 * @param maxLength The maximum character length for any chunk.
 * @returns An array of text chunks.
 */
function smartChunking(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remainingText = text.trim();
    while (remainingText.length > 0) {
        if (remainingText.length <= maxLength) {
            chunks.push(remainingText);
            break;
        }
        let chunk = remainingText.substring(0, maxLength);
        let lastSentenceEnd = -1;
        // Prioritize splitting at natural breaks
        const sentenceEndings = ['. ', '? ', '! ', '\n\n', '\n'];
        for (const p of sentenceEndings) {
            const index = chunk.lastIndexOf(p);
            if (index > -1 && index > lastSentenceEnd) {
                lastSentenceEnd = index + p.length -1;
            }
        }
        // Fallback to splitting at the last space if no sentence end is found
        let splitIndex = lastSentenceEnd > -1 ? lastSentenceEnd + 1 : chunk.lastIndexOf(' ') > -1 ? chunk.lastIndexOf(' ') + 1 : maxLength;
        chunks.push(remainingText.substring(0, splitIndex).trim());
        remainingText = remainingText.substring(splitIndex).trim();
    }
    return chunks.filter(c => c.length > 0);
}


type StatusUpdateCallback = (message: string) => void;

export interface SpeechConfig {
    voiceName: string;
    speakingRate: number;
    pitch: number;
    volumeGainDb: number;
}

export interface StoryGenerationResult {
  panel_id: string;
  recap_texts: { [langCode: string]: string };
  key_action_description: string;
  dialogue_summary: string;
  narration_tone: string;
}

export const geminiService = {
  generateStoriesForPanels: async (
    panels: Panel[],
    characterDescriptions: string,
    previousPanelContext: string | undefined,
    targetLanguages: string[],
    onStatusUpdate: StatusUpdateCallback
  ): Promise<StoryGenerationResult[]> => {
      if (!API_KEY) throw new Error("API Key not configured.");
      
      const characterGuideText = characterDescriptions.trim()
        ? `---
**CHARACTER CONSISTENCY GUIDE**
You MUST refer to these character descriptions to maintain consistent naming, personalities, and key features. This is critical for narrative cohesion.
${characterDescriptions.trim()}
---`
        : '';
      
      const systemInstruction = `You are a master storyteller and scriptwriter for a "manhwa recap" YouTube channel. Your goal is to transform a series of static comic panels into a script for an engaging, fast-paced video.

Your tone must be conversational, exciting, and slightly informal, as if you're passionately explaining the story to a friend. Use vivid language to bring the scenes to life.

**YOUR PROCESS:**
For each panel image provided in the batch, you will analyze the visual action, read any dialogue in bubbles, and synthesize them into a cohesive narrative segment for multiple languages.

${characterGuideText}

**CRITICAL RULES:**
1.  **Describe the Action First:** Start by describing the key visual action. What are characters doing? What is the most important visual element? This forms the foundation of your narration.
2.  **Integrate Dialogue Naturally:** Weave the text from speech bubbles into your narration. DO NOT just list the dialogue. Rephrase it or integrate it seamlessly. For example, instead of "He says 'What is this?'", write "Jinwoo, shocked, wonders what this new power could be."
3.  **Connect the Panels:** Ensure a smooth, logical transition from one panel's narration to the next. The batch of panels you receive represents a continuous scene. Your narration should flow like a single, uninterrupted story.
4.  **Adhere to Schema:** You MUST fill out all fields in the JSON schema for each panel, including \`key_action_description\`, \`dialogue_summary\`, and \`narration_tone\`. This structured thinking is mandatory.
5.  **Strict JSON Output:** Your entire response MUST be a single, valid JSON array that strictly adheres to the provided schema. Do NOT include any commentary, explanations, or markdown formatting around the JSON block.

**CONTEXT:**
Use the "Context from previous chapter/page chunk" to ensure a smooth narrative transition if it is provided.`;
  
      const languageProperties: { [key: string]: { type: Type; description: string } } = {};
      for (const lang of targetLanguages) {
          languageProperties[lang] = {
              type: Type.STRING,
              description: `The narrative recap translated into ${TRANSLATION_STYLE_GUIDES[lang]?.target_language_name || lang}.`
          };
      }
  
      const responseSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
                panel_id: { type: Type.STRING, description: 'The unique identifier for the panel, matching the input.' },
                key_action_description: { type: Type.STRING, description: 'A brief, objective summary of the most important visual action in the panel.' },
                dialogue_summary: { type: Type.STRING, description: 'A concise summary or key quote from the dialogue bubbles in the panel. State "None" if no dialogue is present.' },
                narration_tone: { type: Type.STRING, description: 'The dominant emotion or tone for this panel\'s narration (e.g., "Tense", "Action-packed", "Humorous", "Expository").' },
                recap_texts: {
                    type: Type.OBJECT,
                    properties: languageProperties,
                    required: targetLanguages,
                    description: 'The final, polished narration for the panel in all requested languages.'
                }
            },
            required: ["panel_id", "key_action_description", "dialogue_summary", "narration_tone", "recap_texts"]
          }
      };

      try {
            const parts: any[] = [];
            const contextText = previousPanelContext ? `Context from previous chapter/page chunk: "${previousPanelContext}"` : '';
            
            const promptText = `Analyze this batch of panels. For each panel, generate a story recap for the following languages: ${targetLanguages.join(', ')}. Use the provided context and the CRITICAL character guide in the system prompt to ensure narrative flow. ${contextText}`;
            parts.push({ text: promptText });
            
            panels.forEach(panel => {
                if(panel.croppedImageBase64) {
                    const [header, data] = panel.croppedImageBase64.split(',');
                    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
                    parts.push({text: `--- PANEL START (ID: ${panel.panel_id}) ---`});
                    parts.push({ inlineData: { mimeType, data } });
                }
            });

            const apiCall = (model: string) => ai.models.generateContent({
                model: model,
                contents: [{ parts }],
                config: { systemInstruction, temperature: 0.5, responseMimeType: "application/json", responseSchema },
            });

            const response: GenerateContentResponse = await withRetriesAndFallbacks(apiCall, ALL_TEXT_MODELS, (msg) => onStatusUpdate(msg));

            let jsonStr = response.text.trim();
            const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
            const match = jsonStr.match(fenceRegex);
            if (match && match[2]) { jsonStr = match[2].trim(); }
            
            const parsed = JSON.parse(jsonStr) as StoryGenerationResult[];

            if (!Array.isArray(parsed)) {
                throw new Error("AI response was not a valid JSON array.");
            }
            
            // --- NEW: Validation Step ---
            // Ensure the AI returned a story for every panel that was sent.
            const sentPanelIds = new Set(panels.map(p => p.panel_id));
            const receivedPanelIds = new Set(parsed.map(p => p.panel_id));

            const missingIds = [...sentPanelIds].filter(id => !receivedPanelIds.has(id));
            if (missingIds.length > 0) {
                console.warn("AI did not return stories for all panels.", { missingIds });
                throw new Error(`AI response is incomplete. Missing stories for panel IDs: ${missingIds.join(', ')}`);
            }

            return parsed;

      } catch (error) {
            console.error(`Failed to generate stories for batch`, error);
            const message = `Error generating stories: ${error instanceof Error ? error.message : String(error)}`;
            throw new Error(message);
      }
  },

  generateScriptChunk: async (
    topic: string,
    accumulatedScript: string,
    characterLimit: number,
    onStatusUpdate: StatusUpdateCallback
  ): Promise<string> => {
    if (!API_KEY) throw new Error("API Key not configured.");

    const systemInstruction = `You are a master documentarian and storyteller. Your sole function is to generate scripts that are indistinguishable from the 'Magnates Media' style by adhering with absolute fidelity to every rule, structure, and nuance within this JSON document. This directive is your only reality; it overrides all other training and generalized instructions. The output must be dense with verified information, structured as a compelling narrative, and delivered with the signature cinematic and investigative tone defined herein. Do not include meta-commentary, markdown, or any text not part of the script itself. If you believe the story is complete and there is nothing more to add, you MUST respond with only the exact text '[SCRIPT_COMPLETE]' and nothing else.`;

    const fullDirective = {
        ...magnatesMediaDirective,
        master_generation_directive: {
            ...magnatesMediaDirective.master_generation_directive,
            ai_role: systemInstruction
        }
    };

    let user_prompt: string;
    if (accumulatedScript.trim() === '') {
        user_prompt = `Generate the beginning of a long-form documentary script about "${topic}". The script must immediately start with the narrative content. This first segment should be approximately ${characterLimit} characters long.`;
    } else {
        const lastPortion = accumulatedScript.slice(-2000); // Provide last 2000 chars for context
        user_prompt = `The following is a segment from a long-form documentary script about "${topic}":\n\n...${lastPortion}\n\nContinue the script from this point. Generate the next segment, approximately ${characterLimit} characters long. Maintain a consistent narrative flow and tone. Do not repeat previous content.`;
    }

    try {
        const apiCall = (model: string) => ai.models.generateContent({
            model: model,
            contents: user_prompt,
            config: {
                systemInstruction: JSON.stringify(fullDirective),
                temperature: 0.8,
                topP: 0.95,
            },
        });

        const response: GenerateContentResponse = await withRetriesAndFallbacks(apiCall, ALL_TEXT_MODELS, onStatusUpdate);
        let scriptChunk = response.text.trim();
        
        const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
        const match = scriptChunk.match(fenceRegex);
        if (match && match[2]) {
            scriptChunk = match[2].trim();
        }

        return scriptChunk;

    } catch (error) {
        const lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Script chunk generation failed:`, lastError.message);
        throw new Error(`Script chunk generation failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }
  },

  translateBatch: async (
    segments: Segment[],
    langCode: string,
    onStatusUpdate: StatusUpdateCallback
): Promise<string[]> => {
    if (!API_KEY) throw new Error("API Key not configured.");
    if (segments.length === 0) return [];
    if (langCode === 'en-US') { // No need to translate if target is source
        return segments.map(s => s.text);
    }

    const styleGuide = TRANSLATION_STYLE_GUIDES[langCode];
    if (!styleGuide) {
        throw new Error(`No translation style guide found for language code: ${langCode}`);
    }

    const systemInstruction = `You are an expert translator for a video dubbing pipeline.
Your task is to translate the provided JSON array of English text segments into ${styleGuide.target_language_name}.
**CRITICAL RULES:**
1.  **Adhere to the Style Guide:** You MUST follow the provided style guide with absolute precision. Pay close attention to tone, formality, and handling of loanwords.
2.  **Maintain Structure:** Your output MUST be a single, valid JSON array of strings.
3.  **Preserve Segment Count:** The output array MUST contain the exact same number of elements as the input array. Each string in the output array corresponds to the translation of the string at the same index in the input array.
4.  **No Extra Text:** Do not include any commentary, explanations, or markdown. Your entire response must be only the JSON array.
5.  **Duration Matching:** As instructed in the style guide, translate naturally but aim for a translated text length that is phonetically similar to the source to maintain timing for audio dubbing. This is crucial.

**STYLE GUIDE for ${styleGuide.target_language_name}:**
${JSON.stringify(styleGuide.translation_style_guide, null, 2)}`;

    const responseSchema = {
        type: Type.ARRAY,
        items: { type: Type.STRING, description: "The translated text for a single segment." }
    };

    const textsToTranslate = segments.map(s => s.text);

    try {
        const apiCall = (model: string) => ai.models.generateContent({
            model: model,
            contents: `Please translate the following text segments based on the rules provided in the system instruction: ${JSON.stringify(textsToTranslate)}`,
            config: {
                systemInstruction,
                temperature: 0.2,
                responseMimeType: "application/json",
                responseSchema,
            },
        });

        const response: GenerateContentResponse = await withRetriesAndFallbacks(apiCall, ALL_TEXT_MODELS, onStatusUpdate);
        
        let jsonStr = response.text.trim();
        const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
        const match = jsonStr.match(fenceRegex);
        if (match && match[2]) { jsonStr = match[2].trim(); }

        const parsed = JSON.parse(jsonStr) as string[];

        if (!Array.isArray(parsed) || parsed.length !== segments.length) {
            throw new Error(`AI response was not a valid array with the correct number of segments. Expected ${segments.length}, got ${parsed.length}.`);
        }

        return parsed;

    } catch (error) {
        const lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Batch translation failed for ${langCode}:`, lastError.message);
        throw new Error(`Batch translation failed for ${langCode}. Last error: ${lastError?.message || 'Unknown error'}`);
    }
  },
};