# AI Manga to Video Studio: Technical Architecture & Workflow

## Introduction

This document provides a detailed, implementation-level guide to the AI Manga to Video Studio. Its purpose is to transform entire chapters of manga or manhwa into a sequence of visually distinct, editable, and narrated panels that are ready for video production.

**Core Technologies:**
*   **AI Engine:** Google Gemini for advanced visual analysis, narrative generation, and text-to-speech.
*   **Frontend:** React for a dynamic and responsive user interface.
*   **Image Processing:** The browser's native HTML Canvas API for all client-side image manipulation (stitching and cropping).
*   **Audio Processing:** The Web Audio API for handling and preparing audio data for playback.

---

## Chapter 1: Input & Pre-processing Pipeline

The foundation of the studio is a robust pipeline that correctly ingests, orders, and prepares image files for AI analysis.

### 1.1. Folder Ingestion & Structure

The application is designed to process a standardized folder structure, ensuring that content is handled logically and in the correct order. The user selects a single parent directory.

```
/MyMangaSeries/       <-- User selects this parent folder
  ├── /Chapter 1/
  │   ├── 01.jpg
  │   ├── 02.jpg
  │   └── 03.png
  ├── /Chapter 2/
  │   ├── 01.jpg
  │   ├── 02.webp
  │   └── ...
  └── /Chapter 10/
      ├── 01.jpg
      └── ...
```

### 1.2. Order Preservation: Two-Level Sorting

To maintain narrative integrity, the application enforces a strict sorting order at two levels using `localeCompare` with the `numeric: true` option, which correctly handles numbers within filenames (e.g., sorting "10" after "9").

1.  **Chapter Sorting:** Sub-folders within the parent directory are sorted alphanumerically (e.g., "Chapter 1", "Chapter 2", ... "Chapter 10").
2.  **Page Sorting:** Inside each chapter folder, image files are sorted alphanumerically (e.g., "01.jpg", "02.jpg", ... "11.jpg").

### 1.3. Image Stitching for Context and Efficiency

Instead of analyzing each page individually, the application stitches a group of pages together into a single, tall vertical image.

*   **Purpose:** This technique significantly reduces the number of API calls and provides the AI model with a larger visual and narrative context, leading to more coherent analysis.
*   **Process:** Using the HTML Canvas API, the application draws each page from a chunk (typically 3 pages) sequentially onto a single canvas. This composite image is then converted to a Base64 string to be sent to the Gemini API.

---

## Chapter 2: The Core AI Engine - Visual & Narrative Analysis

This is where the application interprets the visual content and generates the story.

### 2.1. The Master Prompt & Dynamic Instructions

A sophisticated system prompt instructs the Gemini model to act as a specialized "visual analysis AI." The key instructions are:
*   **Dual Persona:** The AI operates in two stages: first as a **Technical Segmenter** to find panel boundaries, and second as a **Narrative Mapper** to create the story.
*   **Gutter-Based Detection:** The AI is strictly ordered to use the empty space (gutters) between panels as the definitive guide for creating bounding boxes, ensuring no artwork is ever cropped.
*   **Reading Order:** The prompt dynamically includes instructions for either top-to-bottom (Manhwa/Webtoon) or right-to-left (Manga) reading order based on user selection.
*   **Dialogue-Driven Story:** The AI generates a conversational, friendly summary for each panel, primarily based on the dialogue and text within its boundaries.
*   **Multilingual Generation:** The AI generates these summaries for all languages selected by the user in a single pass.

### 2.2. Enforcing Structured Output with JSON Schema

To ensure the AI's response is predictable and machine-readable, the API call includes a `responseSchema`. This forces the model to return a valid JSON object with a precise structure: an array of `panel` objects, where each object contains:
*   `coordinates`: An object with `x, y, w, h` values (from 0.0 to 1.0) defining the panel's bounding box.
*   `recap_texts`: An object containing the narrative summary for each target language (e.g., `{ "en-US": "...", "ja-JP": "..." }`).
*   `is_promotional`: A boolean flag to identify and skip non-story panels like credit pages.

### 2.3. Contextual Continuity

To create a seamless story across multiple stitched images, the narrative summary of the *very last panel* from the previous image is passed as context to the AI when it analyzes the next image. This helps maintain a consistent narrative flow.

---

## Chapter 3: The Human Touch - The Interactive Panel Editor

The studio empowers users with full creative control to refine the AI's initial analysis.

### 3.1. Full Control Over Panels

After an initial analysis, the user can enter "Edit Mode" for any page. This turns the page preview into an interactive canvas where they can:
*   **Resize & Move:** Click and drag the corners or body of any panel's bounding box to adjust its size and position.
*   **Create:** Click and drag on an empty area of the page to draw a new bounding box for a panel the AI may have missed.
*   **Delete:** Remove any unwanted or incorrectly identified panels.

### 3.2. Story & Flow Refinement

Editing is not just visual. Users can also:
*   **Merge Panels:** A "Merge with Next" button allows the user to combine the story text of two adjacent panels. This is perfect for fixing cases where the AI incorrectly split a single continuous thought or action.
*   **Edit Text:** The generated story text for every panel and every language is fully editable in a dedicated text area.

### 3.3. Real-time Feedback

The editor is designed for an intuitive experience. As a user resizes a panel's boundary on the main image, the corresponding cropped thumbnail in the panel list on the right updates instantly, providing immediate visual confirmation of the change.

---

## Chapter 4: Client-Side Processing & Narration

Once the panel data is finalized (either by the AI or by the user), the application performs the final steps to create the narrated storyboard.

### 4.1. Client-Side Panel Cropping

Using the finalized `coordinates` for each panel, the application once again uses the HTML Canvas API. It iterates through each panel and crops that specific rectangular area from the large, high-resolution stitched image. This small, cropped image is then displayed in its corresponding panel card in the UI.

### 4.2. Contextual Audio Generation

The final step is to create the voice-over for each panel.
1.  **Iterative Process:** The application loops through every panel for every selected language.
2.  **Context is Key:** For each panel, it sends the story text to the Gemini TTS model. Crucially, it **also sends the text of the *previous* panel** in the same API call.
3.  **Natural Flow:** This contextual information allows the TTS model to generate audio with a more natural intonation and prosody, avoiding a robotic or disjointed feel between clips and creating a smooth, continuous narration.

### 4.3. Final Audio Handling

The TTS model returns raw PCM audio data. A client-side service adds the necessary 44-byte WAV header to this data, converting it into a standard, playable `.wav` file. This file is then represented as a Blob URL and linked to an `<audio>` player in the UI, ready for playback.
