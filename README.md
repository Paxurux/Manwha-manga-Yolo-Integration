# AI Manga to Video Studio: A Complete Technical Implementation & Production Guide

## Introduction

This document provides a definitive, implementation-level guide to the AI Manga to Video Studio. Its purpose is to serve as both a technical deep-dive into the current application and a strategic roadmap for its evolution into a full-scale, production-ready SaaS platform. We will explore the existing architecture, present verbatim code for core AI interactions, and outline the necessary steps to build out features like user accounts, server-side video rendering, and more.

The goal of this application is to transform entire chapters of manga or manhwa into a sequence of visually distinct, editable, and narrated panels, laying the foundation for an automated video production pipeline.

---

## Core Technologies

-   **AI Engine:** Google Gemini (`gemini-2.5-flash` for vision/text, `gemini-2.5-pro-preview-tts` for audio) for advanced visual analysis, narrative generation, and text-to-speech.
-   **Frontend Framework:** React with TypeScript for a dynamic, type-safe, and responsive user interface.
-   **Image Processing (Client-Side):** The browser's native HTML Canvas API is used for all initial image manipulation, including stitching multiple pages together and cropping out individual panels based on AI-generated coordinates.
-   **Audio Processing (Client-Side):** The Web Audio API is used for handling raw audio data from the TTS service and preparing it for playback and download.
-   **Build Tool:** Vite for fast development and bundling.
-   **Styling:** Tailwind CSS for a utility-first, modern design.

---

## Section 1: Current Implementation - A Deep Dive

This section dissects the current application, providing detailed explanations and the exact code used to achieve its functionality.

### 1.1: Project File Structure

Understanding the file structure is key to navigating the codebase.

-   `index.html`: The application's entry point. It loads Tailwind CSS and other necessary scripts before mounting the React app.
-   `index.tsx`: The root of the React application. It renders the main `App` component into the DOM.
-   `App.tsx`: The top-level React component. It manages global state and renders the primary UI layout, which is centered around the `MangaToVideoPanel`.
-   `types.ts`: A central file containing all shared TypeScript type and interface definitions (e.g., `Chapter`, `StitchedImage`, `MarkedPanel`). This ensures type safety across the application.
-   `components/`: This directory houses all reusable React components.
    -   `MangaToVideoPanel.tsx`: The "brain" of the frontend. This massive component manages all state related to manga chapters, handles the file upload process, orchestrates the multi-step AI analysis and narration pipeline, and renders the entire user interface for the feature.
    -   `InteractiveMangaView.tsx`: A specialized component that provides the interactive canvas for editing panel bounding boxes. It handles all user input for creating, resizing, moving, and deleting panels.
    -   `ActionButton.tsx`, `LoadingSpinner.tsx`, `ErrorDisplay.tsx`: General-purpose UI components for a consistent user experience.
-   `services/`: This directory contains modules responsible for all business logic and communication with external APIs.
    -   `geminiService.ts`: The absolute core of the AI logic. This module contains the functions for communicating with the Gemini text and vision models. **We will analyze its functions in-depth.**
    -   `geminiTtsService.ts`: A dedicated service for handling calls to the Gemini Text-to-Speech (TTS) model, including the logic for contextual audio generation.
    -   `audioProcessingService.ts`: A client-side utility module for handling raw audio data, specifically for decoding PCM data and adding the necessary WAV header to make it a playable file.
    -   `translationStyleGuides.ts`: A configuration file containing detailed style guides for various languages, used to instruct the AI during multilingual narrative generation.

### 1.2: The Data Pipeline: From Files to AI-Ready Input

The process begins with ingesting and preparing user-provided image files.

#### **Folder Ingestion & Sorting**

The application is designed to accept a parent folder containing sub-folders for each chapter. It uses the browser's file input `webkitdirectory` attribute. The logic then performs a two-level alphanumeric sort (`localeCompare` with `numeric: true`) to ensure both chapters and the pages within them are in the correct narrative order.

#### **Image Stitching**

To provide the AI with greater context and reduce the number of API calls, the application stitches multiple pages (typically 3) into a single, tall vertical image. This is a crucial optimization step.

**Code Example: `stitchImages` helper function**

This function, used within `MangaToVideoPanel.tsx`, takes an array of `File` objects and uses the HTML Canvas API to create a single composite image.

```typescript
// Location: components/MangaToVideoPanel.tsx (helper function)

/**
 * Stitches multiple image files into a single vertical canvas.
 * @param files An array of image File objects.
 * @returns A promise that resolves to the base64 data URL and MIME type of the stitched image.
 */
const stitchImages = async (files: File[]): Promise<{ base64: string, mimeType: string }> => {
    // 1. Load all files into HTMLImageElement objects
    const images = await Promise.all(files.map(file => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            // Create a temporary URL for the browser to load the image
            img.src = URL.createObjectURL(file);
        });
    }));

    if (images.length === 0) return { base64: '', mimeType: '' };

    // 2. Calculate the dimensions of the final canvas
    const maxWidth = Math.max(...images.map(img => img.width));
    const totalHeight = images.reduce((sum, img) => sum + img.height, 0);

    // 3. Create the canvas and get its 2D rendering context
    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get canvas context");

    // 4. Draw each loaded image onto the canvas in sequence
    let currentY = 0;
    for (const img of images) {
        ctx.drawImage(img, 0, currentY);
        currentY += img.height;
        // 5. Clean up the temporary URL to prevent memory leaks
        URL.revokeObjectURL(img.src);
    }
    
    // 6. Export the canvas content to a Base64 data URL
    const mimeType = files[0].type; // Assume all files in chunk are same type
    return { base64: canvas.toDataURL(mimeType), mimeType };
};
```

### 1.3: Core AI Analysis: Panel Segmentation & Story Generation

This is the most critical step, where the stitched image is sent to the Gemini model for analysis.

#### **The `analyzeAndSegmentMangaPage` Function (Verbatim)**

Below is the complete, fully-commented function from `services/geminiService.ts`. This is the exact code that communicates with the Gemini API to get panel data.

```typescript
// Location: services/geminiService.ts

import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
// ... other imports

export const geminiService = {
  // ... other methods

  /**
   * Analyzes a stitched manga/manhwa image to detect panels, generate multi-lingual story summaries,
   * and identify promotional content.
   *
   * @param stitchedImageBase64 The base64-encoded string of the composite image.
   * @param stitchedImageMimeType The MIME type of the image (e.g., 'image/jpeg').
   * @param contentType The reading order ('manga' for R-T-L, 'manhwa' for T-T-B).
   * @param characterDescriptions User-provided text to ensure character consistency.
   * @param previousChapterContext The summary of the last panel from the previous image chunk.
   * @param targetLanguages An array of language codes for the summaries (e.g., ['en-US', 'ja-JP']).
   * @param onStatusUpdate A callback function for providing real-time status updates to the UI.
   * @returns A promise that resolves to an array of structured panel data from the AI.
   */
  analyzeAndSegmentMangaPage: async (
    stitchedImageBase64: string,
    stitchedImageMimeType: string,
    contentType: 'manga' | 'manhwa',
    characterDescriptions: string, // <-- NEW Parameter
    previousChapterContext: string | undefined,
    targetLanguages: string[],
    onStatusUpdate: StatusUpdateCallback
  ): Promise<{ 
      panel_index: number; 
      coordinates: { x: number; y: number; w: number; h: number; }; 
      recap_texts: { [langCode: string]: string }; 
      is_promotional: boolean; 
    }[]> => {
    
    if (!API_KEY) throw new Error("API Key not configured.");

    // 1. DYNAMICALLY CONSTRUCT THE SYSTEM PROMPT
    // This tailors the AI's instructions based on user input.

    // Instruction for reading order
    let readingOrderInstruction = contentType === 'manga'
        ? `This is a Japanese Manga. ... apply the traditional manga reading order: start at the top-right ... read panels from right-to-left...`
        : `This is a Manhwa/Webtoon. Panels MUST be identified in their natural reading order, which for this vertical format is strictly top-to-bottom.`;

    // Instruction for character consistency (NEW)
    const characterConsistencyInstruction = characterDescriptions.trim()
        ? `---
**CHARACTER CONSISTENCY GUIDE**
Refer to these descriptions to maintain consistent character naming, personalities, and key features in your summaries. This is critical for narrative cohesion.
${characterDescriptions.trim()}
---`
        : '';
    
    // The master system prompt that defines the AI's persona, rules, and objectives.
    const systemInstruction = `You are a highly advanced visual analysis AI, specialized in deconstructing manga pages...
[... The full two-stage prompt for Technical Segmentation and Narrative Mapping goes here, as detailed in the prompt appendix ...]

- **Reading Order:** ${readingOrderInstruction}
${characterConsistencyInstruction} // Inject the new character guide
- **Context:** Use the provided context from the previous page to ensure a seamless narrative flow.
- **Output:** You MUST return a single, valid JSON object with one key: "panels". Do NOT include any commentary or markdown.`;
      
    // 2. PREPARE THE API REQUEST PAYLOAD
    // The payload consists of multiple "parts": the text prompt and the image data.
    const parts: any[] = [];
    
    const contextText = previousChapterContext ? `Context from previous page: "${previousChapterContext}"` : '';
    const userPromptText = `Analyze this ${contentType} page. Generate story recaps for the following languages: ${targetLanguages.join(', ')}. ${contextText}`;
    
    parts.push({ text: userPromptText });

    parts.push({
        inlineData: {
            mimeType: stitchedImageMimeType,
            // The base64 string must not include the "data:mime/type;base64," prefix.
            data: stitchedImageBase64.split(',')[1],
        },
    });

    // 3. DEFINE THE STRICT JSON OUTPUT SCHEMA
    // This is a powerful feature that forces the AI to return valid, structured JSON,
    // eliminating the need for unreliable string parsing.

    const languageProperties: { [key: string]: { type: Type; description: string } } = {};
    for (const lang of targetLanguages) {
        languageProperties[lang] = {
            type: Type.STRING,
            description: `The narrative recap for this panel, translated into ${TRANSLATION_STYLE_GUIDES[lang]?.target_language_name || lang}.`
        };
    }

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
          panels: {
              type: Type.ARRAY,
              description: "An array of detected panels, each with its coordinates and story recap.",
              items: {
                  type: Type.OBJECT,
                  properties: {
                      panel_index: { type: Type.INTEGER, ... },
                      is_promotional: { type: Type.BOOLEAN, ... },
                      coordinates: {
                          type: Type.OBJECT,
                          properties: {
                              x: { type: Type.NUMBER }, y: { type: Type.NUMBER },
                              w: { type: Type.NUMBER }, h: { type: Type.NUMBER }
                          },
                          required: ["x", "y", "w", "h"]
                      },
                      recap_texts: {
                          type: Type.OBJECT,
                          properties: languageProperties,
                          required: targetLanguages,
                      }
                  },
                   required: ["panel_index", "is_promotional", "coordinates", "recap_texts"],
              }
          }
      },
      required: ["panels"]
    };

    // 4. EXECUTE THE API CALL WITH RETRIES AND FALLBACKS
    // The `withRetriesAndFallbacks` helper function (defined elsewhere in the service)
    // attempts the call with the primary model ('gemini-2.5-flash') and automatically
    // cycles through other models if the primary one fails.
    try {
      const apiCall = (model: string) => ai.models.generateContent({
        model: model,
        contents: [{ parts }],
        config: { 
            systemInstruction, 
            temperature: 0.2, // Low temperature for deterministic, factual analysis
            responseMimeType: "application/json",
            responseSchema, // Apply the strict output schema
        },
      });

      const response: GenerateContentResponse = await withRetriesAndFallbacks(apiCall, ALL_TEXT_MODELS, onStatusUpdate);

      // 5. PARSE THE RESPONSE
      // The response.text will be a JSON string guaranteed by the schema.
      let jsonStr = response.text.trim();
      // Clean up potential markdown fences, just in case.
      const match = jsonStr.match(/^```(\w*)?\s*\n?(.*?)\n?\s*```$/s);
      if (match && match[2]) { jsonStr = match[2].trim(); }
      
      const parsed = JSON.parse(jsonStr) as { panels: any[] };

      if (!parsed.panels || !Array.isArray(parsed.panels)) {
          throw new Error("AI response was not in the expected { panels: [...] } format.");
      }
      
      onStatusUpdate(`Panel analysis successful.`);
      return parsed.panels;

    } catch (error) {
      // 6. ERROR HANDLING
      const lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Panel story generation failed:`, lastError.message);
      throw new Error(`Panel story generation failed. Last error: ${lastError.message || 'Unknown error'}`);
    }
  },
};
```

### 1.4: Frontend Logic: State Management & Rendering

The frontend uses React's state management to create a reactive UI.

-   **Central State:** The `chapters` state in `MangaToVideoPanel.tsx` is the single source of truth. It's an array of `Chapter` objects, which contain `StitchedImage` objects, which in turn contain `MarkedPanel` objects. Every action (analysis, editing, narration) updates this central state, causing the UI to re-render automatically.

-   **Rendering Logic:** The component uses nested `.map()` calls to render the hierarchy of chapters, stitched images, and their corresponding panels.

    **Code Snippet: Simplified JSX from `MangaToVideoPanel.tsx`**

    ```jsx
    // Location: components/MangaToVideoPanel.tsx

    return (
        <section>
            {/* ... configuration UI ... */}
            <div className="space-y-8">
                {chapters.map(chapter => (
                    <div key={chapter.id}>
                        <h3>Chapter: {chapter.name}</h3>
                        {chapter.images.map(image => (
                            <div key={image.id}>
                                <h4>{image.file.name}</h4>
                                <div className="grid">
                                    {/* Left side: Image and analysis button */}
                                    <div>
                                        <ActionButton onClick={() => handleAnalyzePage(chapter.id, image.id)}>
                                            Analyze Page
                                        </ActionButton>
                                        <img src={image.base64} />
                                    </div>
                                    {/* Right side: List of detected panels */}
                                    <div>
                                        {image.panels.map(panel => (
                                            <PanelCard key={panel.id} panel={panel} ... />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </section>
    );
    ```

### 1.5: Contextual Audio Generation

To create a natural-sounding narration, the app sends not only the current panel's text to the TTS model but also the text of the *previous* panel. This gives the AI context to adjust its intonation and prosody, avoiding a disjointed, robotic delivery.

**Code Snippet: `generateAudioForSegment` from `services/geminiTtsService.ts`**

```typescript
// Location: services/geminiTtsService.ts

export const generateAudioForSegment = async (
  text: string,
  previousSegmentText: string | undefined, // Context from the previous panel
  voiceName: string,
  speechParams: SpeechConfig,
  onStatusUpdate: StatusUpdateCallback
): Promise<Uint8Array> => {
  // ... error checking ...
  
  const speechConfig = { /* ... voice parameters ... */ };
      
  // 1. Construct content parts. If previous text exists, it's added first.
  const contentParts = [];
  if (previousSegmentText && previousSegmentText.trim()) {
    contentParts.push({ text: previousSegmentText });
  }
  contentParts.push({ text: text }); // The text we actually want audio for is last.

  // 2. Make the API call
  const response: GenerateContentResponse = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: contentParts }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: speechConfig,
    },
  });
  
  // 3. Extract the correct audio part. The API returns one audio part for each
  // text part. Since we want the audio for the *current* text, we take the LAST one.
  const allAudioParts = response.candidates?.[0]?.content?.parts;
  const audioPart = allAudioParts && allAudioParts.length > 0
    ? allAudioParts[allAudioParts.length - 1]
    : undefined;

  // 4. Decode the Base64 response into raw PCM audio data (a Uint8Array)
  if (audioPart && 'inlineData' in audioPart && audioPart.inlineData?.data) {
    const binaryString = atob(audioPart.inlineData.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } else {
    throw new Error("No audio data was generated.");
  }
};
```
The raw PCM data is then given a 44-byte WAV header by `audioProcessingService.ts` to make it a playable file.

---

## Section 2: Future Development & Production Roadmap

This section outlines a strategic plan for evolving the current tool into a commercial SaaS product.

### 2.1: Enhancing Panel Extraction Accuracy

While the current model is effective, its accuracy can be further improved.

-   **Iterative Prompt Engineering:** The master prompt can be refined with more explicit negative constraints. For example: *"A bounding box MUST NEVER bisect a dialogue bubble. A bubble must be contained entirely within one panel."* or *"If two panels have no gutter between them and share a border, identify the artist's intended dividing line."*
-   **Visual Pre-processing:** Before sending the image to Gemini, a client-side pre-processing step could use simple computer vision techniques (e.g., OpenCV.js) to detect large white spaces (gutters) and draw high-contrast outlines around them. This would provide the AI with stronger visual cues, making the gutters even more "gospel."
-   **Advanced Two-Pass AI System:** For a "high-accuracy" mode, a two-pass system could be implemented:
    1.  **Pass 1 (Segmentation):** Use the current method to get the coordinates for all panels on a stitched page.
    2.  **Pass 2 (Targeted Analysis):** Instead of generating summaries from the large image, programmatically crop each panel on the client-side and send *each individual panel image* to a second, simpler Gemini prompt. This prompt would only need to generate a story for the small, focused image, leading to much higher contextual accuracy.
    -   *Trade-off:* This significantly increases API costs but would likely yield near-perfect results.

### 2.2: From Local Script to a SaaS Application

The ultimate goal is a web-based subscription service. Here is a phased approach:

#### **Phase 1: Local Automation (`.bat`/`.sh` script)**

The core logic from `geminiService.ts` could be extracted into a Node.js script. This would allow power-users to run the entire pipeline from their command line, ideal for batch processing large libraries.

-   **Usage:** `node process-manga.js --input "C:/Manga/SeriesA" --output "C:/Output/SeriesA" --lang "en-US,ja-JP" --type "manga"`

#### **Phase 2: The Full SaaS Platform**

This involves building a robust backend and infrastructure.

1.  **Backend Architecture:** A backend server (e.g., Node.js with NestJS, Python with FastAPI) is required to handle business logic that cannot be done on the client.
2.  **User Authentication:** Implement a secure login system using services like Firebase Authentication, Auth0, or a custom JWT (JSON Web Token) implementation. This allows users to have private accounts and projects.
3.  **Database:** Use a database like PostgreSQL (for structured data) or MongoDB (for flexibility) to store user information, project metadata, billing status, and the generated panel data (coordinates, summaries).
4.  **Subscription Management:** Integrate a payment provider like **Stripe** or Paddle to handle monthly/yearly subscriptions. This allows for tiered access (e.g., Free Tier: 1 chapter/month, Pro Tier: 50 chapters/month, API access).
5.  **Cloud File Storage:** For a scalable application, user-uploaded manga chapters should not be stored on the server's local filesystem. They must be uploaded to a dedicated object storage service like **Google Cloud Storage (GCS)** or **Amazon S3**. This decouples storage from the application server and is essential for the video rendering pipeline.

### 2.3: Server-Side Video Rendering Pipeline (The Final Step)

Attempting to render a full video in the user's browser is not feasible; it would be slow, unreliable, and likely crash the browser tab. Video creation **must** be a server-side process.

**Proposed Architecture: A Job Queue System**

This architecture ensures that long-running video rendering tasks do not block the main web application.

1.  **Trigger:** The user finalizes their panels and narration in the web UI and clicks a "Create Video" button. The frontend sends the unique Project ID to the backend API.
2.  **Job Queue:** The backend API does not start rendering immediately. Instead, it creates a "video rendering job" containing the Project ID and pushes it into a message queue (e.g., **RabbitMQ**, Google Cloud Pub/Sub). It then immediately responds to the user with "Your video is being processed and you'll be notified when it's ready."
3.  **Worker Service:** A separate, scalable, and powerful backend service (a "worker") constantly listens to the queue for new jobs. This worker can be a simple Node.js or Python application running on a scalable platform like Google Cloud Run or AWS ECS.
4.  **Rendering with FFMPEG:** When a worker picks up a job, it:
    a.  Reads the Project ID.
    b.  Queries the database to get the data for all panels (order, audio file locations, image file locations).
    c.  Downloads all required panel images and narration `.wav` files from cloud storage (GCS/S3) to its temporary local storage.
    d.  Executes a command using **FFMPEG**, a powerful open-source video processing library.

**FFMPEG Command Deep Dive**

FFMPEG is controlled via complex command-line arguments. The worker would programmatically generate a command like this:

```bash
# This is a conceptual FFMPEG command generated by the worker service.

# First, create a temporary text file listing all audio clips in order.
# (The worker would generate this file dynamically)
# file 'panel_001.wav'
# file 'panel_002.wav'
# file 'panel_003.wav'

# Concatenate all audio clips into a single continuous narration track.
ffmpeg -f concat -safe 0 -i audio_playlist.txt -c copy full_narration.wav

# Now, generate the final video.
ffmpeg \
  -f image2 \
  -loop 1 -t 5.2 -i panel_001.png ` # Input 1: panel 1, duration 5.2s ` \
  -loop 1 -t 4.8 -i panel_002.png ` # Input 2: panel 2, duration 4.8s ` \
  -loop 1 -t 6.1 -i panel_003.png ` # Input 3: panel 3, duration 6.1s ` \
  -i full_narration.wav `             # Input 4: the full audio track ` \
  \
  -filter_complex " \
    [0:v]fade=t=in:st=0:d=0.5,fade=t=out:st=4.7:d=0.5[v0]; \
    [1:v]fade=t=in:st=0:d=0.5,fade=t=out:st=4.3:d=0.5[v1]; \
    [2:v]fade=t=in:st=0:d=0.5,fade=t=out:st=5.6:d=0.5[v2]; \
    [v0][v1][v2]concat=n=3:v=1:a=0 [v] \
  " \
  -map "[v]" \
  -map 3:a \
  -c:v libx264 -r 24 -pix_fmt yuv420p \
  -c:a aac -shortest \
  manga- imported-name-final_video.mp4
```
*   **Explanation:** The worker first determines the duration of each audio clip. It then tells FFMPEG to display each corresponding panel image for exactly that duration (`-t 5.2` for 5.2 seconds). The `-filter_complex` command chains all these timed image segments together (`concat=n=3`) and applies a short fade-in/out effect for a smooth transition. Finally, it maps this new video stream with the full narration audio track into a final `mp4` file.

5.  **Final Steps:**
    a.  The worker uploads the `manga-name-final_video.mp4` to a "completed videos" bucket in GCS/S3.
    b.  It updates the project's status in the database to "Completed" and stores the URL to the final video.
    c.  It deletes all temporary files.
6.  **Notification:** The backend can then notify the user. The simplest method is email. A more advanced method is using WebSockets to push a real-time notification to the user's browser, allowing them to download the video instantly.







Implementation Steps:
1. Update Your Panel Detection Service
Replace your current panelDetectorService.ts with the enhanced version that includes:

YOLO integration with fallback to your existing CV methods
Text bubble detection and OCR
Enhanced AI story generation with text context

2. Add YOLO Backend
Create a simple Python backend:
python# app.py - YOLO API backend
from flask import Flask, request, jsonify
from ultralytics import YOLO
import cv2
import numpy as np

app = Flask(__name__)

# Load models (download from Roboflow)
panel_model = YOLO('webtoon-panel-model.pt')
text_model = YOLO('comic-speech-bubble-model.pt')

@app.route('/api/detect-panels', methods=['POST'])
def detect_panels():
    image_file = request.files['image']
    content_type = request.form.get('contentType', 'manhwa')
    include_text = request.form.get('includeTextBubbles') == 'true'
    
    # Convert to opencv format
    image = cv2.imdecode(np.frombuffer(image_file.read(), np.uint8), cv2.IMREAD_COLOR)
    
    # Detect panels
    panel_results = panel_model(image)
    panels =RetryClaude does not have the ability to run the code it generates yet.Mis yolo is onley detecting panel so how the text and like speach bubble correpsoing to that panel is gettting send to ai and made sure that text is for that panel let me knowEditGreat question! You're absolutely right to be concerned about this. Let me clarify the text-to-panel association process:
How Text Gets Matched to Specific Panels:
The Process:

YOLO detects panels → Gets panel coordinates [x1, y1, x2, y2]
YOLO/OCR detects text bubbles → Gets text coordinates [tx1, ty1, tx2, ty2] + extracted text
Spatial matching algorithm → Determines which text belongs to which panel
Send matched data to AI → Panel image + its associated text

The Spatial Matching Logic:
typescript// This is the key function that links text to panels
function matchTextToPanels(panels, textBubbles) {
  const panelTextPairs = [];
  
  for (let panel of panels) {
    const matchedTexts = [];
    
    for (let textBubble of textBubbles) {
      // Check if text bubble overlaps with panel boundaries
      if (isTextInsidePanel(panel.bbox, textBubble.bbox)) {
        matchedTexts.push(textBubble.text);
      }
    }
    
    panelTextPairs.push({
      panelImage: panel.croppedImage,
      associatedText: matchedTexts.join(' '), // Combined text for this panel
      panelId: panel.id
    });
  }
  
  return panelTextPairs;
}

// Geometric overlap detection
function isTextInsidePanel(panelBox, textBox) {
  const [px1, py1, px2, py2] = panelBox;     // Panel boundaries
  const [tx1, ty1, tx2, ty2] = textBox;     // Text bubble boundaries
  
  // Check if text bubble is inside or overlapping panel
  return !(tx2 < px1 || tx1 > px2 || ty2 < py1 || ty1 > py2);
}
Visual Example:
Panel 1: [x:0, y:0, width:300, height:200]
├── Text Bubble A: [x:50, y:30, width:100, height:20] → "Hello!"
├── Text Bubble B: [x:180, y:150, width:80, height:15] → "How are you?"
└── Result: Panel 1 gets text: "Hello! How are you?"

Panel 2: [x:320, y:0, width:280, height:200]  
├── Text Bubble C: [x:350, y:80, width:120, height:25] → "I'm fine!"
└── Result: Panel 2 gets text: "I'm fine!"
What Gets Sent to AI:
json{
  "panelImage": "<cropped panel 1 image>",
  "extractedText": "Hello! How are you?",
  "context": "Previous panel context...",
  "prompt": "Generate story for this panel using both visual and text content"
}
Potential Issues & Solutions:
Problem 1: Text Bubble Spans Multiple Panels
typescript// Solution: Use overlap percentage threshold
function getTextPanelAssignment(textBubble, panels) {
  let bestMatch = null;
  let maxOverlap = 0;
  
  for (let panel of panels) {
    const overlapArea = calculateOverlapArea(textBubble.bbox, panel.bbox);
    const overlapPercentage = overlapArea / calculateTextArea(textBubble.bbox);
    
    if (overlapPercentage > maxOverlap && overlapPercentage > 0.5) {
      maxOverlap = overlapPercentage;
      bestMatch = panel;
    }
  }
  
  return bestMatch;
}
Problem 2: Text Outside Panel Boundaries
typescript// Solution: Expand panel search area
function isTextNearPanel(textBox, panelBox, tolerance = 20) {
  const [px1, py1, px2, py2] = panelBox;
  const expandedPanel = [px1-tolerance, py1-tolerance, px2+tolerance, py2+tolerance];
  return isOverlapping(textBox, expandedPanel);
}
Problem 3: No Text Detected for Panel
typescript// Solution: Send panel with empty text context
const panelData = {
  panelImage: panel.image,
  extractedText: matchedTexts.length > 0 ? matchedTexts.join(' ') : '',
  hasText: matchedTexts.length > 0,
  aiPrompt: matchedTexts.length > 0 
    ? "Analyze this panel with text: '" + matchedTexts.join(' ') + "'"
    : "Analyze this panel (no text detected, focus on visual story)"
};
Alternative Approach: Two-Step AI Process
If spatial matching isn't accurate enough:
typescript// Step 1: Send full page to AI for text-panel association
const associationPrompt = `
Analyze this manhwa page and for each detected panel, 
identify which speech bubbles/text belong to it.
Return JSON: [
  {panelNumber: 1, associatedText: ["bubble1", "bubble2"]},
  {panelNumber: 2, associatedText: ["bubble3"]}
]
`;

// Step 2: Use AI-provided associations for story generation
for (let association of aiAssociations) {
  const panel = panels[association.panelNumber - 1];
  const text = association.associatedText.join(' ');
  
  await generateStoryForPanel(panel, text);
}  




// Enhanced panelDetectorService.ts with YOLO integration

import { Panel, PanelDetectionResult } from '../types';

interface YOLODetection {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
  class: string;
}

interface YOLOResponse {
  panels: YOLODetection[];
  textBubbles?: YOLODetection[];
}

class EnhancedPanelDetectorService {
  private useYOLO: boolean;
  private yoloEndpoint: string;
  private fallbackToCV: boolean;

  constructor(
    useYOLO: boolean = true, 
    yoloEndpoint: string = '/api/detect-panels',
    fallbackToCV: boolean = true
  ) {
    this.useYOLO = useYOLO;
    this.yoloEndpoint = yoloEndpoint;
    this.fallbackToCV = fallbackToCV;
  }

  async detectPanels(
    imageFile: File, 
    contentType: 'manhwa' | 'manga'
  ): Promise<PanelDetectionResult> {
    try {
      if (this.useYOLO) {
        console.log('🤖 Using YOLO panel detection...');
        return await this.detectWithYOLO(imageFile, contentType);
      } else {
        console.log('🔧 Using legacy CV detection...');
        return await this.detectWithCV(imageFile, contentType);
      }
    } catch (error) {
      console.error('YOLO detection failed:', error);
      
      if (this.fallbackToCV) {
        console.log('🔄 Falling back to CV detection...');
        return await this.detectWithCV(imageFile, contentType);
      }
      
      throw error;
    }
  }

  private async detectWithYOLO(
    imageFile: File, 
    contentType: 'manhwa' | 'manga'
  ): Promise<PanelDetectionResult> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('contentType', contentType);
    formData.append('includeTextBubbles', 'true');

    const response = await fetch(this.yoloEndpoint, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`YOLO API error: ${response.status}`);
    }

    const yoloResult: YOLOResponse = await response.json();
    
    // Convert YOLO format to your existing Panel format
    const panels = await this.convertYOLOToPanels(yoloResult, imageFile);
    
    // Extract text information for better AI context
    const textBubbles = yoloResult.textBubbles || [];
    const textData = await this.extractTextFromBubbles(textBubbles, imageFile);

    return {
      panels,
      textData, // New: Include extracted text for AI context
      detectionMethod: 'yolo',
      confidence: this.calculateAverageConfidence(yoloResult.panels)
    };
  }

  private async convertYOLOToPanels(
    yoloResult: YOLOResponse, 
    imageFile: File
  ): Promise<Panel[]> {
    const image = await this.loadImage(imageFile);
    const panels: Panel[] = [];

    for (let i = 0; i < yoloResult.panels.length; i++) {
      const detection = yoloResult.panels[i];
      const [x1, y1, x2, y2] = detection.bbox;

      // Create panel in your existing format
      const panel: Panel = {
        id: `panel-${Date.now()}-${i}`,
        bounds: {
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1
        },
        croppedImage: await this.cropImage(image, detection.bbox),
        confidence: detection.confidence,
        textBubbles: [], // Will be populated by text bubble matching
        detectionMethod: 'yolo'
      };

      panels.push(panel);
    }

    // Sort panels by reading order (top to bottom, left to right)
    return this.sortPanelsByReadingOrder(panels);
  }

  private async extractTextFromBubbles(
    textBubbles: YOLODetection[], 
    imageFile: File
  ): Promise<any[]> {
    if (textBubbles.length === 0) return [];

    // Use Tesseract.js for OCR on detected text bubbles
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng+kor+jpn');

    const textData = [];
    
    for (const bubble of textBubbles) {
      try {
        const croppedBubble = await this.cropImage(imageFile, bubble.bbox);
        const { data } = await worker.recognize(croppedBubble);
        
        textData.push({
          text: data.text.trim(),
          confidence: bubble.confidence,
          bbox: bubble.bbox,
          ocrConfidence: data.confidence
        });
      } catch (error) {
        console.warn('OCR failed for text bubble:', error);
      }
    }

    await worker.terminate();
    return textData;
  }

  private async detectWithCV(
    imageFile: File, 
    contentType: 'manhwa' | 'manga'
  ): Promise<PanelDetectionResult> {
    // Your existing CV detection logic
    // Keep this as fallback for when YOLO fails
    
    if (contentType === 'manhwa') {
      return await this.detectManhwaPanels(imageFile);
    } else {
      return await this.detectMangaPanels(imageFile);
    }
  }

  // Keep your existing CV methods as fallback
  private async detectManhwaPanels(imageFile: File): Promise<PanelDetectionResult> {
    // Your existing manhwa detection logic
    // This is your whitespace projection algorithm
    return { panels: [], detectionMethod: 'cv-manhwa' };
  }

  private async detectMangaPanels(imageFile: File): Promise<PanelDetectionResult> {
    // Your existing manga detection logic  
    // This is your contour detection algorithm
    return { panels: [], detectionMethod: 'cv-manga' };
  }

  private sortPanelsByReadingOrder(panels: Panel[]): Panel[] {
    return panels.sort((a, b) => {
      // Sort by Y position first (top to bottom)
      if (Math.abs(a.bounds.y - b.bounds.y) > 50) {
        return a.bounds.y - b.bounds.y;
      }
      // Then by X position (left to right)
      return a.bounds.x - b.bounds.x;
    });
  }

  private calculateAverageConfidence(detections: YOLODetection[]): number {
    if (detections.length === 0) return 0;
    const sum = detections.reduce((acc, det) => acc + det.confidence, 0);
    return sum / detections.length;
  }

  private async loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  private async cropImage(
    source: HTMLImageElement | File, 
    bbox: [number, number, number, number]
  ): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const [x1, y1, x2, y2] = bbox;
    
    canvas.width = x2 - x1;
    canvas.height = y2 - y1;

    if (source instanceof HTMLImageElement) {
      ctx.drawImage(source, x1, y1, x2 - x1, y2 - y1, 0, 0, x2 - x1, y2 - y1);
    } else {
      const img = await this.loadImage(source);
      ctx.drawImage(img, x1, y1, x2 - x1, y2 - y1, 0, 0, x2 - x1, y2 - y1);
    }

    return canvas;
  }

  // New method: Enhanced story generation with text context
  async generateStoryWithTextContext(
    panel: Panel, 
    textData: any[], 
    previousContext?: string
  ): Promise<string> {
    // Match text bubbles to this panel
    const panelTextBubbles = textData.filter(text => 
      this.isTextInPanel(text.bbox, panel.bounds)
    );

    const extractedText = panelTextBubbles
      .map(bubble => bubble.text)
      .join(' ')
      .trim();

    const enhancedPrompt = `
    Generate a story recap for this panel:
    
    Extracted Text: "${extractedText}"
    Previous Context: "${previousContext || 'Start of chapter'}"
    
    Create a natural, flowing narrative that incorporates both the visual scene and any dialogue/text.
    Consider the previous context to maintain story continuity.
    
    Return in JSON format:
    {
      "story_recap": "Brief engaging narrative",
      "dialogue_summary": "Key dialogue points",
      "scene_description": "Visual description",
      "emotional_tone": "Mood of the scene"
    }
    `;

    // Use your existing Gemini integration
    return await this.callGeminiForStory(panel.croppedImage, enhancedPrompt);
  }

  private isTextInPanel(
    textBbox: [number, number, number, number], 
    panelBounds: { x: number, y: number, width: number, height: number }
  ): boolean {
    const [tx1, ty1, tx2, ty2] = textBbox;
    const px1 = panelBounds.x;
    const py1 = panelBounds.y;
    const px2 = panelBounds.x + panelBounds.width;
    const py2 = panelBounds.y + panelBounds.height;

    // Check if text bubble overlaps with panel
    return !(tx2 < px1 || tx1 > px2 || ty2 < py1 || ty1 > py2);
  }

  private async callGeminiForStory(image: HTMLCanvasElement, prompt: string): Promise<string> {
    // Your existing Gemini integration
    // This should already exist in your codebase
    return "Generated story...";
  }
}

// Updated types for your existing interfaces
interface PanelDetectionResult {
  panels: Panel[];
  textData?: any[]; // New: Include text extraction results
  detectionMethod: 'yolo' | 'cv-manhwa' | 'cv-manga';
  confidence?: number;
}

interface Panel {
  id: string;
  bounds: { x: number, y: number, width: number, height: number };
  croppedImage: HTMLCanvasElement;
  confidence?: number;
  textBubbles?: any[]; // New: Associated text bubbles
  detectionMethod?: string;
}

export default EnhancedPanelDetectorService;



// videoGenerationService.ts - Generate animated videos from panels

interface VideoPanel {
  id: string;
  image: HTMLCanvasElement;
  audioBlob: Blob;
  duration: number;
  text: string;
  isLinked?: boolean;
  linkedPanels?: VideoPanel[];
}

interface VideoGenerationOptions {
  width: number;
  height: number;
  fps: number;
  transitionDuration: number;
  panelDisplayDuration: number;
  backgroundBlurAmount: number;
  zoomEffect: {
    enabled: boolean;
    startScale: number;
    endScale: number;
  };
}

class VideoGenerationService {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  async generateChapterVideo(
    panels: VideoPanel[], 
    options: VideoGenerationOptions
  ): Promise<Blob> {
    // Set up canvas dimensions
    this.canvas.width = options.width;
    this.canvas.height = options.height;

    // Create media recorder for video capture
    const stream = this.canvas.captureStream(options.fps);
    const audioContext = new AudioContext();
    
    // Combine all audio tracks
    const combinedAudio = await this.combineAudioTracks(panels, audioContext);
    
    // Add audio to stream
    const audioDestination = audioContext.createMediaStreamDestination();
    combinedAudio.connect(audioDestination);
    
    const combinedStream = new MediaStream([
      ...stream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks()
    ]);

    this.mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: 'video/webm;codecs=vp9,opus'
    });

    this.recordedChunks = [];
    
    return new Promise((resolve, reject) => {
      this.mediaRecorder!.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder!.onstop = () => {
        const videoBlob = new Blob(this.recordedChunks, { type: 'video/webm' });
        resolve(videoBlob);
      };

      this.mediaRecorder!.onerror = reject;

      this.startVideoGeneration(panels, options);
    });
  }

  private async startVideoGeneration(
    panels: VideoPanel[], 
    options: VideoGenerationOptions
  ): Promise<void> {
    this.mediaRecorder!.start();
    
    let currentTime = 0;

    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const nextPanel = panels[i + 1];

      // Process linked panels as a group
      if (panel.isLinked && panel.linkedPanels) {
        await this.renderLinkedPanelScene(panel.linkedPanels, options, currentTime);
        currentTime += panel.duration;
        continue;
      }

      // Single panel rendering
      await this.renderPanelScene(panel, nextPanel, options, currentTime);
      currentTime += panel.duration;
    }

    this.mediaRecorder!.stop();
  }

  private async renderPanelScene(
    currentPanel: VideoPanel,
    nextPanel: VideoPanel | undefined,
    options: VideoGenerationOptions,
    startTime: number
  ): Promise<void> {
    const frameDuration = 1000 / options.fps;
    const totalFrames = Math.floor(currentPanel.duration / frameDuration);

    for (let frame = 0; frame < totalFrames; frame++) {
      const progress = frame / totalFrames;
      
      // Clear canvas
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Render background (blurred panel filling screen)
      await this.renderBlurredBackground(currentPanel.image, options.backgroundBlurAmount);

      // Render foreground panel with zoom effect
      await this.renderForegroundPanel(currentPanel.image, progress, options);

      // Handle transition to next panel
      if (nextPanel && progress > 0.8) {
        const transitionProgress = (progress - 0.8) / 0.2;
        await this.renderTransition(currentPanel.image, nextPanel.image, transitionProgress, options);
      }

      // Wait for next frame
      await this.waitForFrame(frameDuration);
    }
  }

  private async renderLinkedPanelScene(
    linkedPanels: VideoPanel[],
    options: VideoGenerationOptions,
    startTime: number
  ): Promise<void> {
    // For linked panels, show multiple panels simultaneously
    const frameDuration = 1000 / options.fps;
    const sceneDuration = linkedPanels[0].duration; // Use first panel's duration
    const totalFrames = Math.floor(sceneDuration / frameDuration);

    for (let frame = 0; frame < totalFrames; frame++) {
      const progress = frame / totalFrames;
      
      // Clear canvas
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Render background (blurred composite of linked panels)
      await this.renderLinkedBackground(linkedPanels, options.backgroundBlurAmount);

      // Render multiple panels in foreground
      await this.renderLinkedForegroundPanels(linkedPanels, progress, options);

      await this.waitForFrame(frameDuration);
    }
  }

  private async renderBlurredBackground(
    panelImage: HTMLCanvasElement, 
    blurAmount: number
  ): Promise<void> {
    // Create temporary canvas for blur effect
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d')!;
    
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;

    // Scale and center the panel to fill the screen
    const scale = Math.max(
      this.canvas.width / panelImage.width,
      this.canvas.height / panelImage.height
    );

    const scaledWidth = panelImage.width * scale;
    const scaledHeight = panelImage.height * scale;
    const x = (this.canvas.width - scaledWidth) / 2;
    const y = (this.canvas.height - scaledHeight) / 2;

    // Draw scaled image
    tempCtx.drawImage(panelImage, x, y, scaledWidth, scaledHeight);

    // Apply blur effect
    tempCtx.filter = `blur(${blurAmount}px)`;
    this.ctx.drawImage(tempCanvas, 0, 0);
    
    // Add dark overlay for better foreground visibility
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private async renderForegroundPanel(
    panelImage: HTMLCanvasElement,
    progress: number,
    options: VideoGenerationOptions
  ): Promise<void> {
    if (!options.zoomEffect.enabled) {
      // Simple centered rendering without zoom
      const scale = Math.min(
        (this.canvas.width * 0.8) / panelImage.width,
        (this.canvas.height * 0.8) / panelImage.height
      );

      const width = panelImage.width * scale;
      const height = panelImage.height * scale;
      const x = (this.canvas.width - width) / 2;
      const y = (this.canvas.height - height) / 2;

      this.ctx.drawImage(panelImage, x, y, width, height);
      return;
    }

    // Zoom effect implementation
    const currentScale = this.lerp(
      options.zoomEffect.startScale,
      options.zoomEffect.endScale,
      this.easeInOut(progress)
    );

    const baseScale = Math.min(
      (this.canvas.width * 0.8) / panelImage.width,
      (this.canvas.height * 0.8) / panelImage.height
    );

    const finalScale = baseScale * currentScale;
    const width = panelImage.width * finalScale;
    const height = panelImage.height * finalScale;
    const x = (this.canvas.width - width) / 2;
    const y = (this.canvas.height - height) / 2;

    // Add subtle shadow/glow effect
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    this.ctx.shadowBlur = 20;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 10;

    this.ctx.drawImage(panelImage, x, y, width, height);

    // Reset shadow
    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;
  }

  private async renderLinkedBackground(
    linkedPanels: VideoPanel[],
    blurAmount: number
  ): Promise<void> {
    // Create composite background from all linked panels
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d')!;
    
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;

    // Draw each panel with reduced opacity
    const alpha = 1 / linkedPanels.length;
    tempCtx.globalAlpha = alpha;

    for (const panel of linkedPanels) {
      const scale = Math.max(
        this.canvas.width / panel.image.width,
        this.canvas.height / panel.image.height
      );

      const scaledWidth = panel.image.width * scale;
      const scaledHeight = panel.image.height * scale;
      const x = (this.canvas.width - scaledWidth) / 2;
      const y = (this.canvas.height - scaledHeight) / 2;

      tempCtx.drawImage(panel.image, x, y, scaledWidth, scaledHeight);
    }

    tempCtx.globalAlpha = 1;

    // Apply blur and draw to main canvas
    tempCtx.filter = `blur(${blurAmount}px)`;
    this.ctx.drawImage(tempCanvas, 0, 0);
    
    // Dark overlay
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private async renderLinkedForegroundPanels(
    linkedPanels: VideoPanel[],
    progress: number,
    options: VideoGenerationOptions
  ): Promise<void> {
    // Arrange multiple panels on screen
    if (linkedPanels.length === 2) {
      // Side by side arrangement
      const panelWidth = this.canvas.width * 0.4;
      const spacing = this.canvas.width * 0.1;

      for (let i = 0; i < linkedPanels.length; i++) {
        const panel = linkedPanels[i];
        const scale = Math.min(
          panelWidth / panel.image.width,
          (this.canvas.height * 0.8) / panel.image.height
        );

        const width = panel.image.width * scale;
        const height = panel.image.height * scale;
        const x = spacing + (panelWidth + spacing) * i;
        const y = (this.canvas.height - height) / 2;

        // Add zoom effect
        if (options.zoomEffect.enabled) {
          const currentScale = this.lerp(
            options.zoomEffect.startScale,
            options.zoomEffect.endScale,
            this.easeInOut(progress)
          );
          
          const finalWidth = width * currentScale;
          const finalHeight = height * currentScale;
          const finalX = x + (width - finalWidth) / 2;
          const finalY = y + (height - finalHeight) / 2;

          this.ctx.drawImage(panel.image, finalX, finalY, finalWidth, finalHeight);
        } else {
          this.ctx.drawImage(panel.image, x, y, width, height);
        }
      }
    } else {
      // Grid arrangement for more panels
      const cols = Math.ceil(Math.sqrt(linkedPanels.length));
      const rows = Math.ceil(linkedPanels.length / cols);
      const panelWidth = this.canvas.width * 0.8 / cols;
      const panelHeight = this.canvas.height * 0.8 / rows;

      for (let i = 0; i < linkedPanels.length; i++) {
        const panel = linkedPanels[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        
        const scale = Math.min(
          panelWidth / panel.image.width,
          panelHeight / panel.image.height
        ) * 0.9; // Leave some spacing

        const width = panel.image.width * scale;
        const height = panel.image.height * scale;
        const x = this.canvas.width * 0.1 + col * panelWidth + (panelWidth - width) / 2;
        const y = this.canvas.height * 0.1 + row * panelHeight + (panelHeight - height) / 2;

        this.ctx.drawImage(panel.image, x, y, width, height);
      }
    }
  }

  private async renderTransition(
    currentImage: HTMLCanvasElement,
    nextImage: HTMLCanvasElement,
    progress: number,
    options: VideoGenerationOptions
  ): Promise<void> {
    // Simple fade transition
    this.ctx.globalAlpha = 1 - progress;
    await this.renderForegroundPanel(currentImage, 1, options);
    
    this.ctx.globalAlpha = progress;
    await this.renderForegroundPanel(nextImage, 0, options);
    
    this.ctx.globalAlpha = 1;
  }

  private async combineAudioTracks(
    panels: VideoPanel[],
    audioContext: AudioContext
  ): Promise<AudioNode> {
    const gainNode = audioContext.createGain();
    let currentTime = 0;

    for (const panel of panels) {
      try {
        const arrayBuffer = await panel.audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);
        source.start(currentTime);
        
        currentTime += panel.duration / 1000; // Convert to seconds
      } catch (error) {
        console.warn('Failed to process audio for panel:', panel.id, error);
      }
    }

    return gainNode;
  }

  // Utility functions
  private lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  private waitForFrame(duration: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, duration));
  }

  // Integration method for your existing system
  async generateVideoFromChapter(
    chapterPanels: any[], // Your existing panel format
    audioFiles: Blob[],
    customOptions?: Partial<VideoGenerationOptions>
  ): Promise<Blob> {
    const defaultOptions: VideoGenerationOptions = {
      width: 1920,
      height: 1080,
      fps: 30,
      transitionDuration: 500,
      panelDisplayDuration: 3000,
      backgroundBlurAmount: 15,
      zoomEffect: {
        enabled: true,
        startScale: 1.0,
        endScale: 1.1
      }
    };

    const options = { ...defaultOptions, ...customOptions };

    // Convert your panels to VideoPanel format
    const videoPanels: VideoPanel[] = chapterPanels.map((panel, index) => ({
      id: panel.id,
      image: panel.croppedImage,
      audioBlob: audioFiles[index],
      duration: options.panelDisplayDuration,
      text: panel.generatedText || '',
      isLinked: panel.linkedScenes?.length > 1,
      linkedPanels: panel.linkedScenes?.map((linkedId: string) => 
        chapterPanels.find(p => p.id === linkedId)
      )
    }));

    return await this.generateChapterVideo(videoPanels, options);
  }
}

export default VideoGenerationService;





Kokoro Implementation -- 

# Complete Kokoro TTS Integration Guide

## Overview
This comprehensive guide explains how Kokoro TTS has been integrated into this manga-to-video project and provides a complete blueprint for implementing similar multi-AI systems with automatic rotation and failover capabilities.

## Table of Contents
1. [Kokoro TTS Integration Architecture](#kokoro-tts-integration-architecture)
2. [Implementation Details](#implementation-details)
3. [Multi-AI Provider System](#multi-ai-provider-system)
4. [API Key Management & Rotation](#api-key-management--rotation)
5. [Complete Code Examples](#complete-code-examples)
6. [Integration with Panel Summaries](#integration-with-panel-summaries)
7. [Step-by-Step Implementation Guide](#step-by-step-implementation-guide)
8. [Multi-AI Rotation System](#multi-ai-rotation-system)
9. [Best Practices & Troubleshooting](#best-practices--troubleshooting)

---

## Kokoro TTS Integration Architecture

### System Overview
The project implements a dual-mode TTS system:
- **Browser-based Kokoro TTS**: Runs entirely in the browser using WebAssembly
- **Cloud-based Gemini TTS**: Uses Google's cloud API
- **Automatic Failover**: Seamlessly switches between providers when one fails

### Key Components
```
├── services/
│   ├── kokoroSimpleService.ts      # Browser-based Kokoro implementation
│   ├── kokoroBackendService.ts     # Server-based Kokoro (optional)
│   ├── geminiTtsService.ts         # Gemini TTS service
│   └── apiKeyManager.ts            # Multi-key rotation system
├── components/
│   ├── KokoroTTSPanel.tsx          # Kokoro UI component
│   ├── TTSSelectionPanel.tsx       # TTS provider selector
│   └── ApiKeyManager.tsx           # API key management UI
└── server/
    └── server.js                   # Optional backend server
```

---

## Implementation Details

### 1. Kokoro Simple Service (Browser-based)

```typescript
// services/kokoroSimpleService.ts
import { KokoroTTS } from "kokoro-js";

export interface KokoroVoice {
  id: string;
  name: string;
  traits: string;
  quality: string;
  language: string;
}

export const KOKORO_VOICES: KokoroVoice[] = [
  // American English Female
  { id: "af_heart", name: "Heart (Female)", traits: "❤️ Warm", quality: "A", language: "American English" },
  { id: "af_bella", name: "Bella (Female)", traits: "🔥 Energetic", quality: "A", language: "American English" },
  // ... more voices
];

class KokoroSimpleService {
  private tts: KokoroTTS | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (this.isInitializing) {
      // Wait for existing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.isInitialized;
    }

    this.isInitializing = true;
    try {
      console.log('🔄 Initializing Kokoro TTS...');
      
      // Initialize with ONNX model for better compatibility
      this.tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8", // Quantized for better performance
        device: "wasm", // Use WebAssembly for broad compatibility
      });

      this.isInitialized = true;
      console.log('✅ Kokoro TTS initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Kokoro TTS:', error);
      this.isInitialized = false;
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  async generateSpeech(text: string, voice: string = 'af_heart'): Promise<string> {
    if (!this.isInitialized) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('Kokoro TTS failed to initialize');
      }
    }

    if (!this.tts) {
      throw new Error('Kokoro TTS not available');
    }

    try {
      console.log(`🎵 Generating speech for: "${text.substring(0, 50)}..." with voice: ${voice}`);
      
      // Generate audio using the Kokoro TTS
      const audio = await this.tts.generate(text, { voice: voice as any });
      
      if (audio && audio.audio) {
        // Convert Float32Array to WAV format and then to base64
        const wavBuffer = this.float32ArrayToWav(audio.audio, audio.sampling_rate || 24000);
        const base64Audio = this.arrayBufferToBase64(wavBuffer);
        return `data:audio/wav;base64,${base64Audio}`;
      }
      
      throw new Error('No audio data generated');
    } catch (error) {
      console.error('❌ Speech generation failed:', error);
      throw new Error(`Speech generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Helper function to convert Float32Array to WAV format
  private float32ArrayToWav(audioData: Float32Array, sampleRate: number): ArrayBuffer {
    const length = audioData.length;
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
    
    return buffer;
  }

  // Helper function to convert ArrayBuffer to base64
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async testVoice(voice: string): Promise<{ success: boolean; audio?: string; error?: string }> {
    try {
      const testText = "Hello, this is a voice test for manga video generation.";
      const audio = await this.generateSpeech(testText, voice);
      return { success: true, audio: audio };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  getVoices(): KokoroVoice[] {
    return KOKORO_VOICES;
  }

  isReady(): boolean {
    return this.isInitialized && this.tts !== null;
  }
}

export const kokoroSimpleService = new KokoroSimpleService();
```

### 2. API Key Management System

```typescript
// services/apiKeyManager.ts
export class ApiKeyManager {
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;
  private keyUsageCount: Map<string, number> = new Map();
  private keyErrors: Map<string, number> = new Map();
  private maxErrorsPerKey = 3;

  constructor() {
    this.loadApiKeys();
  }

  private async loadApiKeys(): Promise<void> {
    try {
      // Try to load from public file first
      const response = await fetch('/api-keys.txt');
      if (response.ok) {
        const text = await response.text();
        this.apiKeys = text
          .split('\n')
          .map(key => key.trim())
          .filter(key => key.length > 0 && key.startsWith('AIza'));
        console.log(`Loaded ${this.apiKeys.length} API keys from file`);
      }
    } catch (error) {
      console.log('No api-keys.txt file found, checking localStorage...');
    }

    // Fallback to localStorage
    try {
      const storedKeys = localStorage.getItem('gemini-api-keys');
      if (storedKeys && this.apiKeys.length === 0) {
        const parsedKeys = JSON.parse(storedKeys);
        if (Array.isArray(parsedKeys)) {
          this.apiKeys = parsedKeys.filter(key => key.startsWith('AIza'));
          console.log(`Loaded ${this.apiKeys.length} API keys from localStorage`);
        }
      }
    } catch (error) {
      console.log('Failed to load API keys from localStorage:', error);
    }
  }

  getCurrentKey(): string {
    if (this.apiKeys.length === 0) {
      throw new Error('No API keys available');
    }
    return this.apiKeys[this.currentKeyIndex];
  }

  rotateToNextKey(): string {
    if (this.apiKeys.length === 0) {
      throw new Error('No API keys available');
    }
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    return this.getCurrentKey();
  }

  markKeyError(key: string): void {
    const errorCount = this.keyErrors.get(key) || 0;
    this.keyErrors.set(key, errorCount + 1);

    if (errorCount + 1 >= this.maxErrorsPerKey) {
      console.warn(`API key has reached max errors (${this.maxErrorsPerKey}), rotating to next key`);
      this.rotateToNextKey();
    }
  }

  incrementUsage(key: string): void {
    const usage = this.keyUsageCount.get(key) || 0;
    this.keyUsageCount.set(key, usage + 1);
  }

  addApiKey(key: string): void {
    if (key.trim().startsWith('AIza') && !this.apiKeys.includes(key.trim())) {
      this.apiKeys.push(key.trim());
      console.log(`Added new API key. Total keys: ${this.apiKeys.length}`);
      this.saveKeysToLocalStorage();
    }
  }

  private saveKeysToLocalStorage(): void {
    try {
      localStorage.setItem('gemini-api-keys', JSON.stringify(this.apiKeys));
    } catch (error) {
      console.error('Failed to save API keys to localStorage:', error);
    }
  }

  getTotalKeys(): number {
    return this.apiKeys.length;
  }
}

export const apiKeyManager = new ApiKeyManager();
```

### 3. Multi-AI Provider System with Automatic Rotation

```typescript
// services/geminiService.ts (excerpt showing rotation logic)
const SCRIPT_GENERATION_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-pro",
  "gemini-1.5-pro-002",
  // ... more fallback models
];

async function withRetriesAndFallbacks<T>(
  apiCallFn: (model: string, apiKey: string) => Promise<T>,
  models: string[],
  onAttempt: (message: string) => void,
  retriesPerModel = 2
): Promise<T> {
  let lastError: Error | null = null;

  for (const model of models) {
    // Try all API keys for this model
    const totalKeys = apiKeyManager.getTotalKeys();
    let keyAttempts = 0;

    while (keyAttempts < totalKeys) {
      try {
        const currentKey = apiKeyManager.getCurrentKey();
        ai = new GoogleGenAI({ apiKey: currentKey });

        const fn = () => {
          apiKeyManager.incrementUsage(currentKey);
          return apiCallFn(model, currentKey);
        };

        const onRetry = (attempt: number, error: Error) => {
          onAttempt(`[${model}] [Key ${keyAttempts + 1}/${totalKeys}] Failed (attempt ${attempt}/${retriesPerModel}). Retrying...`);
        };

        onAttempt(`Attempting with model: ${model} [Key ${keyAttempts + 1}/${totalKeys}]...`);

        // Use the standard retry logic for the current model and key combination
        return await withRetries(fn, onRetry, retriesPerModel, 1500);

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const currentKey = apiKeyManager.getCurrentKey();

        // Check if it's a quota/auth error that suggests we should rotate keys
        const errorMessage = lastError.message.toLowerCase();
        if (errorMessage.includes('quota') || errorMessage.includes('limit') || errorMessage.includes('auth')) {
          apiKeyManager.markKeyError(currentKey);
          onAttempt(`Key quota/auth error. Rotating to next key...`);
          apiKeyManager.rotateToNextKey();
        } else {
          onAttempt(`Model [${model}] failed with current key. Trying next key...`);
          apiKeyManager.rotateToNextKey();
        }

        keyAttempts++;
      }
    }

    onAttempt(`All keys exhausted for model [${model}]. Trying next model...`);
  }

  throw new Error(`All fallback models and API keys failed. Last error: ${lastError?.message}`);
}
```

---

## Multi-AI Provider System

### TTS Configuration Interface

```typescript
// types.ts
export interface TTSConfig {
  engine: 'gemini' | 'kokoro';
  voice: string;
  settings: {
    speakingRate: number;
    pitch: number;
    volumeGain: number;
  };
  customVoiceFile?: File;
}
```

### TTS Selection Component

```typescript
// components/TTSSelectionPanel.tsx
const TTSSelectionPanel: React.FC<TTSSelectionPanelProps> = ({
  ttsConfig,
  onTtsConfigChange,
  disabled = false
}) => {
  const handleEngineChange = (engine: 'gemini' | 'kokoro') => {
    // Reset voice to first available when switching engines
    const defaultVoice = engine === 'gemini' ? TTS_VOICES[0].name : KOKORO_VOICES[0].id;
    
    onTtsConfigChange({
      ...ttsConfig,
      engine,
      voice: defaultVoice,
      customVoiceFile: undefined
    });
  };

  const handleTestVoice = async () => {
    setIsTestingVoice(true);
    try {
      const testText = "This is a voice test for manga video generation.";
      
      if (ttsConfig.engine === 'gemini') {
        // Import and use Gemini TTS service
        const { generateAudioForSegment } = await import('../services/geminiTtsService');
        const audioData = await generateAudioForSegment(
          testText,
          undefined,
          ttsConfig.voice,
          ttsConfig.settings,
          () => {}
        );
        
        // Convert to playable audio
        const audioBlob = new Blob([audioData], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        
        // Clean up after playing
        audio.onended = () => URL.revokeObjectURL(audioUrl);
      } else {
        // Use Kokoro TTS service
        const { kokoroSimpleService } = await import('../services/kokoroSimpleService');
        const audioDataUrl = await kokoroSimpleService.generateSpeech(testText, ttsConfig.voice);
        const audio = new Audio(audioDataUrl);
        audio.play();
      }
    } catch (error) {
      console.error('Voice test failed:', error);
      alert('Voice test failed. Please check your TTS configuration.');
    } finally {
      setIsTestingVoice(false);
    }
  };

  return (
    <div className="bg-gray-900/70 p-4 rounded-lg space-y-4">
      {/* TTS Engine Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          TTS Engine
        </label>
        <div className="flex space-x-4">
          <label className="flex items-center">
            <input
              type="radio"
              name="tts-engine"
              value="gemini"
              checked={ttsConfig.engine === 'gemini'}
              onChange={() => handleEngineChange('gemini')}
              disabled={disabled}
              className="mr-2"
            />
            <span className="text-gray-200">Gemini TTS (Cloud)</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              name="tts-engine"
              value="kokoro"
              checked={ttsConfig.engine === 'kokoro'}
              onChange={() => handleEngineChange('kokoro')}
              disabled={disabled}
              className="mr-2"
            />
            <span className="text-gray-200">Kokoro TTS (Local)</span>
          </label>
        </div>
      </div>

      {/* Voice Selection */}
      <div>
        <select
          className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-200"
          value={ttsConfig.voice}
          onChange={(e) => handleVoiceChange(e.target.value)}
          disabled={disabled}
        >
          {getAvailableVoices().map(voice => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          ))}
        </select>
      </div>

      {/* Voice Test Button */}
      <ActionButton
        onClick={handleTestVoice}
        isLoading={isTestingVoice}
        disabled={disabled || isTestingVoice}
      >
        Test Voice
      </ActionButton>
    </div>
  );
};
```

---

## Integration with Panel Summaries

### Panel Audio Generation

```typescript
// components/EnhancedPanelDisplay.tsx (excerpt)
const generateAudio = async () => {
  if (!hasText) {
    setAudioError('No text available for audio generation');
    return;
  }

  setIsGeneratingAudio(true);
  setAudioError('');

  try {
    let audioBase64: string;

    if (ttsProvider === 'kokoro') {
      if (!kokoroSimpleService.isServiceAvailable()) {
        throw new Error('Kokoro TTS backend not available. Please ensure the service is running.');
      }
      audioBase64 = await kokoroSimpleService.generateSpeech(text, globalVoice);
    } else {
      // Use Gemini TTS
      const result = await generateAudioForSegment(
        text,
        undefined,
        globalVoice,
        { speakingRate: 1.0, pitch: 0, volumeGainDb: 0 },
        (msg) => console.log(msg)
      );
      audioBase64 = result.audioBase64;
    }

    const newAudioInfo: AudioInfo = {
      audioBase64,
      voice: globalVoice,
      text,
      provider: ttsProvider,
      duration: 0,
      error: undefined
    };

    onAudioGenerated(panel.panel_id, language, newAudioInfo);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Audio generation failed';
    setAudioError(errorMessage);
    
    const errorAudioInfo: AudioInfo = {
      src: '',
      duration: 0,
      error: errorMessage
    };
    
    onAudioGenerated(panel.panel_id, language, errorAudioInfo);
  } finally {
    setIsGeneratingAudio(false);
  }
};
```

---

## Step-by-Step Implementation Guide

### Step 1: Install Dependencies

```bash
# Install Kokoro TTS
npm install kokoro-js

# Install Google Generative AI
npm install @google/genai

# Install additional dependencies
npm install axios cors express multer
```

### Step 2: Create API Key File

Create a file named `api-keys.txt` in your public directory:

```
AIzaSyABC123...your-first-api-key
AIzaSyDEF456...your-second-api-key
AIzaSyGHI789...your-third-api-key
```

### Step 3: Implement Kokoro Service

```typescript
// services/kokoroSimpleService.ts
import { KokoroTTS } from "kokoro-js";

class KokoroSimpleService {
  private tts: KokoroTTS | null = null;
  private isInitialized = false;

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      this.tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "wasm",
      });
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize Kokoro TTS:', error);
      return false;
    }
  }

  async generateSpeech(text: string, voice: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const audio = await this.tts!.generate(text, { voice });
    // Convert to base64 audio data URL
    const wavBuffer = this.float32ArrayToWav(audio.audio, audio.sampling_rate);
    const base64Audio = this.arrayBufferToBase64(wavBuffer);
    return `data:audio/wav;base64,${base64Audio}`;
  }

  // Helper methods for audio conversion...
}

export const kokoroSimpleService = new KokoroSimpleService();
```

### Step 4: Implement API Key Manager

```typescript
// services/apiKeyManager.ts
export class ApiKeyManager {
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;

  async loadApiKeys(): Promise<void> {
    try {
      const response = await fetch('/api-keys.txt');
      if (response.ok) {
        const text = await response.text();
        this.apiKeys = text.split('\n')
          .map(key => key.trim())
          .filter(key => key.startsWith('AIza'));
      }
    } catch (error) {
      console.log('Loading from localStorage...');
      const stored = localStorage.getItem('gemini-api-keys');
      if (stored) {
        this.apiKeys = JSON.parse(stored);
      }
    }
  }

  getCurrentKey(): string {
    return this.apiKeys[this.currentKeyIndex];
  }

  rotateToNextKey(): string {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    return this.getCurrentKey();
  }
}
```

### Step 5: Create TTS Selection UI

```typescript
// components/TTSSelectionPanel.tsx
const TTSSelectionPanel: React.FC = ({ ttsConfig, onTtsConfigChange }) => {
  const handleEngineChange = (engine: 'gemini' | 'kokoro') => {
    onTtsConfigChange({
      ...ttsConfig,
      engine,
      voice: engine === 'gemini' ? 'en-US-Journey-D' : 'af_heart'
    });
  };

  return (
    <div>
      <div>
        <input
          type="radio"
          value="gemini"
          checked={ttsConfig.engine === 'gemini'}
          onChange={() => handleEngineChange('gemini')}
        />
        <label>Gemini TTS (Cloud)</label>
      </div>
      <div>
        <input
          type="radio"
          value="kokoro"
          checked={ttsConfig.engine === 'kokoro'}
          onChange={() => handleEngineChange('kokoro')}
        />
        <label>Kokoro TTS (Local)</label>
      </div>
      
      <select
        value={ttsConfig.voice}
        onChange={(e) => onTtsConfigChange({...ttsConfig, voice: e.target.value})}
      >
        {/* Voice options based on selected engine */}
      </select>
    </div>
  );
};
```

### Step 6: Integrate with Panel Processing

```typescript
// In your main component
const generatePanelAudio = async (panel: Panel, text: string) => {
  try {
    let audioData: string;

    if (ttsConfig.engine === 'kokoro') {
      audioData = await kokoroSimpleService.generateSpeech(text, ttsConfig.voice);
    } else {
      const result = await generateAudioForSegment(
        text,
        undefined,
        ttsConfig.voice,
        ttsConfig.settings,
        (msg) => console.log(msg)
      );
      // Convert Uint8Array to base64 data URL
      audioData = `data:audio/wav;base64,${btoa(String.fromCharCode(...result))}`;
    }

    // Store audio data in panel
    panel.audioInfos[selectedLanguage] = {
      audioBase64: audioData,
      voice: ttsConfig.voice,
      text: text,
      provider: ttsConfig.engine,
      duration: 0
    };

  } catch (error) {
    console.error('Audio generation failed:', error);
    // Handle error appropriately
  }
};
```

---

## Multi-AI Rotation System

### Infinite Loop Rotation Logic

```typescript
// Advanced rotation system with infinite loop protection
class MultiAIRotationSystem {
  private providers: AIProvider[] = [];
  private currentProviderIndex = 0;
  private failureCount = new Map<string, number>();
  private maxFailuresPerProvider = 3;
  private cooldownPeriod = 5 * 60 * 1000; // 5 minutes
  private lastFailureTime = new Map<string, number>();

  async executeWithRotation<T>(
    operation: (provider: AIProvider) => Promise<T>,
    maxAttempts: number = 10
  ): Promise<T> {
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < maxAttempts) {
      const provider = this.getCurrentProvider();
      
      // Check if provider is in cooldown
      if (this.isProviderInCooldown(provider)) {
        this.rotateToNextProvider();
        attempts++;
        continue;
      }

      try {
        const result = await operation(provider);
        // Reset failure count on success
        this.failureCount.set(provider.id, 0);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Increment failure count
        const failures = this.failureCount.get(provider.id) || 0;
        this.failureCount.set(provider.id, failures + 1);
        this.lastFailureTime.set(provider.id, Date.now());

        // Check if provider should be temporarily disabled
        if (failures + 1 >= this.maxFailuresPerProvider) {
          console.warn(`Provider ${provider.id} disabled due to repeated failures`);
        }

        // Rotate to next provider
        this.rotateToNextProvider();
        attempts++;
      }
    }

    throw new Error(`All providers failed after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
  }

  private isProviderInCooldown(provider: AIProvider): boolean {
    const failures = this.failureCount.get(provider.id) || 0;
    if (failures < this.maxFailuresPerProvider) return false;

    const lastFailure = this.lastFailureTime.get(provider.id) || 0;
    const timeSinceFailure = Date.now() - lastFailure;
    
    if (timeSinceFailure > this.cooldownPeriod) {
      // Reset failure count after cooldown
      this.failureCount.set(provider.id, 0);
      return false;
    }

    return true;
  }

  private rotateToNextProvider(): void {
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
  }

  private getCurrentProvider(): AIProvider {
    return this.providers[this.currentProviderIndex];
  }
}
```

### Usage Example

```typescript
// Example usage of the rotation system
const rotationSystem = new MultiAIRotationSystem();

// Add providers
rotationSystem.addProvider({
  id: 'gemini',
  generateAudio: (text, voice) => geminiTtsService.generate(text, voice),
  isAvailable: () => apiKeyManager.getTotalKeys() > 0
});

rotationSystem.addProvider({
  id: 'kokoro',
  generateAudio: (text, voice) => kokoroSimpleService.generateSpeech(text, voice),
  isAvailable: () => kokoroSimpleService.isReady()
});

// Use with automatic rotation
const audioData = await rotationSystem.executeWithRotation(async (provider) => {
  return await provider.generateAudio(panelText, selectedVoice);
});
```

---

## Best Practices & Troubleshooting

### 1. API Key Management Best Practices

```typescript
// Best practices for API key management
class SecureApiKeyManager extends ApiKeyManager {
  // Validate API key format
  private validateApiKey(key: string): boolean {
    return key.startsWith('AIza') && key.length >= 39;
  }

  // Rate limiting per key
  private rateLimitCheck(key: string): boolean {
    const usage = this.keyUsageCount.get(key) || 0;
    const timeWindow = 60 * 1000; // 1 minute
    const maxRequestsPerMinute = 60;
    
    // Implement sliding window rate limiting
    return usage < maxRequestsPerMinute;
  }

  // Health check for keys
  async healthCheckKey(key: string): Promise<boolean> {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      await ai.models.generateContent({
        model: 'gemini-pro',
        contents: 'test'
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}
```

### 2. Error Handling Strategies

```typescript
// Comprehensive error handling
class ErrorHandler {
  static handleTTSError(error: Error, provider: string): string {
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      return `${provider} quota exceeded. Rotating to next provider...`;
    } else if (errorMessage.includes('auth') || errorMessage.includes('permission')) {
      return `${provider} authentication failed. Check API keys...`;
    } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return `Network error with ${provider}. Retrying...`;
    } else {
      return `Unknown error with ${provider}: ${error.message}`;
    }
  }

  static shouldRetry(error: Error): boolean {
    const retryableErrors = ['network', 'timeout', 'rate limit', 'temporary'];
    return retryableErrors.some(keyword => 
      error.message.toLowerCase().includes(keyword)
    );
  }
}
```

### 3. Performance Optimization

```typescript
// Performance optimization techniques
class TTSOptimizer {
  // Cache frequently used audio
  private audioCache = new Map<string, string>();
  
  async generateWithCache(text: string, voice: string, provider: string): Promise<string> {
    const cacheKey = `${provider}-${voice}-${this.hashText(text)}`;
    
    if (this.audioCache.has(cacheKey)) {
      return this.audioCache.get(cacheKey)!;
    }

    const audio = await this.generateAudio(text, voice, provider);
    this.audioCache.set(cacheKey, audio);
    
    // Implement cache size limit
    if (this.audioCache.size > 100) {
      const firstKey = this.audioCache.keys().next().value;
      this.audioCache.delete(firstKey);
    }

    return audio;
  }

  // Batch processing for multiple panels
  async generateBatch(panels: Panel[], batchSize: number = 5): Promise<void> {
    for (let i = 0; i < panels.length; i += batchSize) {
      const batch = panels.slice(i, i + batchSize);
      await Promise.all(batch.map(panel => this.generatePanelAudio(panel)));
      
      // Small delay between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private hashText(text: string): string {
    // Simple hash function for caching
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }
}
```

### 4. Monitoring and Analytics

```typescript
// Monitoring system for AI providers
class AIProviderMonitor {
  private metrics = new Map<string, ProviderMetrics>();

  recordSuccess(providerId: string, responseTime: number): void {
    const metrics = this.getOrCreateMetrics(providerId);
    metrics.successCount++;
    metrics.totalResponseTime += responseTime;
    metrics.lastSuccessTime = Date.now();
  }

  recordFailure(providerId: string, error: Error): void {
    const metrics = this.getOrCreateMetrics(providerId);
    metrics.failureCount++;
    metrics.lastFailureTime = Date.now();
    metrics.lastError = error.message;
  }

  getProviderStats(providerId: string): ProviderStats {
    const metrics = this.metrics.get(providerId);
    if (!metrics) return this.createEmptyStats();

    const totalRequests = metrics.successCount + metrics.failureCount;
    const successRate = totalRequests > 0 ? metrics.successCount / totalRequests : 0;
    const avgResponseTime = metrics.successCount > 0 ? 
      metrics.totalResponseTime / metrics.successCount : 0;

    return {
      successRate,
      avgResponseTime,
      totalRequests,
      lastSuccessTime: metrics.lastSuccessTime,
      lastFailureTime: metrics.lastFailureTime,
      lastError: metrics.lastError
    };
  }

  // Generate health report
  generateHealthReport(): HealthReport {
    const report: HealthReport = {
      timestamp: Date.now(),
      providers: {}
    };

    for (const [providerId, metrics] of this.metrics) {
      report.providers[providerId] = this.getProviderStats(providerId);
    }

    return report;
  }
}
```

### 5. Troubleshooting Common Issues

#### Issue: Kokoro TTS fails to initialize
```typescript
// Solution: Check browser compatibility and provide fallbacks
async initializeWithFallback(): Promise<boolean> {
  try {
    // Try WebAssembly first
    this.tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "wasm",
    });
    return true;
  } catch (error) {
    console.warn('WebAssembly initialization failed, trying CPU fallback:', error);
    
    try {
      // Fallback to CPU
      this.tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "fp32",
        device: "cpu",
      });
      return true;
    } catch (fallbackError) {
      console.error('All initialization methods failed:', fallbackError);
      return false;
    }
  }
}
```

#### Issue: API quota exceeded
```typescript
// Solution: Implement intelligent key rotation
async handleQuotaExceeded(currentKey: string): Promise<void> {
  // Mark current key as temporarily unavailable
  this.markKeyAsUnavailable(currentKey, 24 * 60 * 60 * 1000); // 24 hours
  
  // Rotate to next available key
  const nextKey = this.getNextAvailableKey();
  if (!nextKey) {
    throw new Error('All API keys have exceeded their quotas. Please wait or add more keys.');
  }
  
  this.setCurrentKey(nextKey);
}
```

#### Issue: Network connectivity problems
```typescript
// Solution: Implement retry with exponential backoff
async retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}
```

---

## Conclusion

This comprehensive guide provides everything needed to implement Kokoro TTS integration with a robust multi-AI provider system. The key benefits of this approach include:

1. **Redundancy**: Multiple TTS providers ensure service availability
2. **Automatic Failover**: Seamless switching when one provider fails
3. **Cost Optimization**: Intelligent API key rotation prevents quota issues
4. **Performance**: Browser-based Kokoro TTS reduces server load
5. **Scalability**: Easy to add new AI providers to the rotation system

The system is designed to be resilient, efficient, and easy to maintain, making it suitable for production use in manga-to-video generation applications and similar projects requiring reliable AI services.

### Quick Setup Summary

1. **Install Dependencies**: `npm install kokoro-js @google/genai`
2. **Create API Keys File**: Add `api-keys.txt` with your Gemini API keys
3. **Implement Services**: Copy the service files from this guide
4. **Add UI Components**: Implement the TTS selection and management panels
5. **Integrate with Your App**: Connect the services to your panel processing logic
6. **Test and Monitor**: Use the provided monitoring tools to ensure reliability

This implementation provides a solid foundation for any project requiring multiple AI services with automatic rotation and failover capabilities.