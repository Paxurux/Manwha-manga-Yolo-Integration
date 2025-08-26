// path: services/panelDetectorService.ts

import { Panel, CoordinatesArray } from '../types';

/**
 * A client-side implementation of manga/manhwa panel detection logic,
 * inspired by the user's provided Python computer vision script.
 * This service uses the HTML Canvas API to perform image analysis
 * directly in the browser, removing the need for a server or an initial
 * AI call for panel segmentation.
 */

// --- Helper Functions for Image Processing ---

/**
 * Loads an image from a base64 source and draws it onto a canvas.
 * @param imageSrc The base64 data URL of the image.
 * @returns A promise that resolves to an object containing the canvas, its 2D context, and dimensions.
 */
const loadImageToCanvas = (imageSrc: string): Promise<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
}> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const width = img.width;
            const height = img.height;
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return reject(new Error("Could not get canvas context"));
            ctx.drawImage(img, 0, 0);
            resolve({ canvas, ctx, width, height });
        };
        img.onerror = () => reject(new Error("Failed to load image for panel detection."));
        img.src = imageSrc;
    });
};

/**
 * Converts the canvas image data to a grayscale representation.
 * @param ctx The 2D context of the canvas.
 * @param width The width of the canvas.
 * @param height The height of the canvas.
 * @returns A Uint8ClampedArray representing the grayscale pixel data.
 */
const toGrayscale = (ctx: CanvasRenderingContext2D, width: number, height: number): Uint8ClampedArray => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const grayData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const grayscale = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        grayData[i / 4] = grayscale;
    }
    return grayData;
};


/**
 * Implements a simple Sobel operator for basic edge detection.
 * This is a client-side approximation of a more complex Canny edge detector.
 * @param grayData The grayscale pixel data.
 * @param width The width of the image.
 * @param height The height of the image.
 * @returns An object containing the gradient magnitude data and the max gradient value.
 */
const sobelEdgeDetection = (grayData: Uint8ClampedArray, width: number, height: number) => {
    const Gx = [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1]
    ];
    const Gy = [
        [-1, -2, -1],
        [0, 0, 0],
        [1, 2, 1]
    ];
    const magnitude = new Float32Array(width * height);
    let maxMagnitude = 0;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    const pixel = grayData[(y + i) * width + (x + j)];
                    sumX += pixel * Gx[i + 1][j + 1];
                    sumY += pixel * Gy[i + 1][j + 1];
                }
            }
            const mag = Math.sqrt(sumX * sumX + sumY * sumY);
            magnitude[y * width + x] = mag;
            if (mag > maxMagnitude) maxMagnitude = mag;
        }
    }
    return { magnitude, maxMagnitude };
};


/**
 * Detects panels by analyzing horizontal whitespace (gutters).
 * This is effective for vertically scrolling manhwa.
 * @param grayData The grayscale pixel data.
 * @param width The width of the image.
 * @param height The height of the image.
 * @returns An array of detected panel bounding boxes.
 */
const detectByWhitespace = (grayData: Uint8ClampedArray, width: number, height: number): Omit<Panel, 'panel_id' | 'index'>[] => {
    const panels: Omit<Panel, 'panel_id'|'index'>[] = [];
    const WHITESPACE_THRESHOLD = 250; // Pixels lighter than this are considered white
    const MIN_GUTTER_HEIGHT = 10; // Minimum number of consecutive white rows to be a gutter
    const MIN_PANEL_HEIGHT = height * 0.05; // Panels must be at least 5% of total height

    const horizontalProjection = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            horizontalProjection[y] += grayData[y * width + x];
        }
    }

    const boundaries = [0];
    let inGutter = false;
    for (let y = 0; y < height; y++) {
        const avgPixelValue = horizontalProjection[y] / width;
        if (avgPixelValue > WHITESPACE_THRESHOLD) {
            if (!inGutter) {
                // Start of a potential gutter
                inGutter = true;
                const lookahead = y + MIN_GUTTER_HEIGHT;
                let isConsistentGutter = true;
                for (let i = y + 1; i < lookahead && i < height; i++) {
                    if (horizontalProjection[i] / width < WHITESPACE_THRESHOLD) {
                        isConsistentGutter = false;
                        break;
                    }
                }
                if (isConsistentGutter) {
                    const lastBoundary = boundaries[boundaries.length - 1];
                    if (y - lastBoundary > MIN_PANEL_HEIGHT) {
                       boundaries.push(y);
                    }
                }
            }
        } else {
             inGutter = false;
        }
    }
    boundaries.push(height);

    for (let i = 0; i < boundaries.length - 1; i++) {
        const y_start = boundaries[i];
        const y_end = boundaries[i+1];
        const h = y_end - y_start;

        if(h > MIN_PANEL_HEIGHT) {
            panels.push({
                coordinates: [0, y_start / height, 1, h / height] as CoordinatesArray,
                confidence: 0.8, // Whitespace detection is fairly reliable
                audioInfos: {},
                status: 'pending',
                flags: { is_promotional: false }
            });
        }
    }

    return panels;
};


// --- Main Service Object ---

export const panelDetectorService = {
  /**
   * Main function to detect panels in a manga page image using client-side logic.
   * @param imageSrc The base64 data URL of the stitched image.
   * @returns A promise that resolves to an array of detected Panel objects.
   */
  detectPanels: async (imageSrc: string): Promise<Omit<Panel, 'index'>[]> => {
    const { ctx, width, height } = await loadImageToCanvas(imageSrc);
    const grayData = toGrayscale(ctx, width, height);
    
    // --- Method 1: Whitespace/Gutter Detection (Primary method for Manhwa) ---
    const whitespacePanels = detectByWhitespace(grayData, width, height);

    // --- Future methods can be added here (e.g., edge-based for manga) ---
    // For now, we rely on the most robust method for the vertical format.
    
    if (whitespacePanels.length === 0) {
        // If no gutters are found, fallback to treating the whole image as one panel.
        return [{
            panel_id: 'fallback-0',
            coordinates: [0, 0, 1, 1],
            confidence: 0.3,
            audioInfos: {},
            status: 'pending',
            flags: {}
        }];
    }
    
    // Assign unique IDs to the detected panels
    return whitespacePanels.map((p, i) => ({
      ...p,
      panel_id: `cv-${Date.now()}-${i}`
    }));
  },
};
