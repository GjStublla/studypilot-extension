import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerationConfig,
  Part,
} from "@google/generative-ai";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

if (!API_KEY) {
  throw new Error(
    "[StudyPilot] VITE_GEMINI_API_KEY is not set. Add it to your .env file."
  );
}

const genAI = new GoogleGenerativeAI(API_KEY);

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const GENERATION_CONFIG: GenerationConfig = {
  temperature: 0.4,
  topP: 0.9,
  maxOutputTokens: 1024,
};

const VISION_MODEL = "gemini-1.5-flash";
const TEXT_MODEL = "gemini-1.5-flash";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiStreamChunk {
  text: string;
  done: boolean;
}

export type StreamCallback = (chunk: GeminiStreamChunk) => void;

export interface LiveReadingSession {
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Helper: data URL → inline image Part
// ---------------------------------------------------------------------------

function dataUrlToPart(dataUrl: string): Part {
  // dataUrl = "data:image/png;base64,<data>"
  const [header, data] = dataUrl.split(",");
  const mimeType = header.replace("data:", "").replace(";base64", "") as
    | "image/png"
    | "image/jpeg"
    | "image/webp";

  return {
    inlineData: {
      mimeType,
      data,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: stream a model response and fire callbacks
// ---------------------------------------------------------------------------

async function streamResponse(
  model: GenerativeModel,
  parts: Part[],
  onChunk: StreamCallback
): Promise<void> {
  const result = await model.generateContentStream(parts);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      onChunk({ text, done: false });
    }
  }

  onChunk({ text: "", done: true });
}

// ---------------------------------------------------------------------------
// 1. Screenshot analysis
//    Pass a data URL from chrome.tabs.captureVisibleTab() and an optional
//    question. Streams the answer back via onChunk.
// ---------------------------------------------------------------------------

const SCREENSHOT_SYSTEM_PROMPT = `You are StudyPilot, an AI study companion embedded in a browser extension.
The user has shared a screenshot of their screen. Analyse what they are studying and answer their question clearly and concisely.
If no question is provided, summarise the key concepts visible on screen and offer one useful insight.
Use plain language, avoid jargon unless the content itself requires it, and keep your response focused and helpful.`;

export async function analyzeScreenshot(
  screenshotDataUrl: string,
  question: string = "",
  onChunk: StreamCallback
): Promise<void> {
  const model = genAI.getGenerativeModel({
    model: VISION_MODEL,
    generationConfig: GENERATION_CONFIG,
    systemInstruction: SCREENSHOT_SYSTEM_PROMPT,
  });

  const imagePart = dataUrlToPart(screenshotDataUrl);
  const textPart: Part = {
    text: question.trim() || "What is on this screen? Summarise what I'm studying.",
  };

  await streamResponse(model, [imagePart, textPart], onChunk);
}

// ---------------------------------------------------------------------------
// 2. Live screen reading
//    Captures frames from a MediaStream on an interval, sends each frame to
//    Gemini, and streams a running narration back.
//
//    Usage:
//      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
//      const session = startLiveReading(stream, onChunk);
//      // later:
//      session.stop();
// ---------------------------------------------------------------------------

const LIVE_READING_SYSTEM_PROMPT = `You are StudyPilot, an AI study companion embedded in a browser extension.
You are watching the user's screen in real time. For each frame you receive:
- Briefly describe any new or changed content you notice (do not repeat yourself between frames).
- If the user is reading text, summarise the key idea in that passage.
- If the user is watching a video or presentation, narrate what is happening.
- If the screen hasn't meaningfully changed, respond with only the word "UNCHANGED".
Keep each response short — two or three sentences at most.`;

const LIVE_FRAME_INTERVAL_MS = 3000; // capture a frame every 3 seconds
const CANVAS_QUALITY = 0.7; // JPEG quality for frame compression

function captureFrameFromStream(stream: MediaStream): string | null {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") return null;

  const settings = track.getSettings();
  const width = settings.width ?? 1280;
  const height = settings.height ?? 720;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // ImageCapture API is the cleanest way but isn't available in all contexts.
  // We draw from a hidden <video> element as the universal fallback.
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;

  // Note: this is synchronous once the video is already playing.
  // The caller is responsible for ensuring the stream is active.
  ctx.drawImage(video, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", CANVAS_QUALITY);
}

export function startLiveReading(
  stream: MediaStream,
  onChunk: StreamCallback
): LiveReadingSession {
  const model = genAI.getGenerativeModel({
    model: VISION_MODEL,
    generationConfig: { ...GENERATION_CONFIG, maxOutputTokens: 256 },
    systemInstruction: LIVE_READING_SYSTEM_PROMPT,
  });

  let stopped = false;
  let frameTimer: ReturnType<typeof setInterval> | null = null;

  async function processFrame() {
    if (stopped) return;

    const dataUrl = captureFrameFromStream(stream);
    if (!dataUrl) return;

    try {
      const imagePart = dataUrlToPart(dataUrl);
      const textPart: Part = { text: "What do you see on screen right now?" };

      const result = await model.generateContentStream([imagePart, textPart]);

      let fullText = "";
      for await (const chunk of result.stream) {
        fullText += chunk.text();
      }

      // Skip "no change" frames — don't clutter the UI
      if (fullText.trim().toUpperCase() === "UNCHANGED") return;

      // Emit the full frame response as a single chunk so the UI can
      // display it as a discrete update rather than mid-sentence fragments
      onChunk({ text: fullText, done: false });
    } catch (err) {
      console.error("[StudyPilot] Live reading frame error:", err);
    }
  }

  // Kick off the first frame immediately, then on interval
  processFrame();
  frameTimer = setInterval(processFrame, LIVE_FRAME_INTERVAL_MS);

  return {
    stop() {
      stopped = true;
      if (frameTimer !== null) {
        clearInterval(frameTimer);
        frameTimer = null;
      }
      onChunk({ text: "", done: true });
    },
  };
}

// ---------------------------------------------------------------------------
// 3. General text Q&A (no image)
//    For follow-up questions after a screenshot analysis, or when the user
//    types a question without capturing the screen.
// ---------------------------------------------------------------------------

const QA_SYSTEM_PROMPT = `You are StudyPilot, an AI study companion embedded in a browser extension.
Answer the student's question clearly, accurately, and concisely.
If the question is ambiguous, make a reasonable assumption and state it briefly.
Avoid filler phrases. Get to the answer quickly.`;

export async function askQuestion(
  question: string,
  onChunk: StreamCallback,
  context?: string // optional: paste in prior conversation or page text
): Promise<void> {
  const model = genAI.getGenerativeModel({
    model: TEXT_MODEL,
    generationConfig: GENERATION_CONFIG,
    systemInstruction: QA_SYSTEM_PROMPT,
  });

  const parts: Part[] = [];

  if (context?.trim()) {
    parts.push({ text: `Context:\n${context.trim()}\n\nQuestion: ${question}` });
  } else {
    parts.push({ text: question });
  }

  await streamResponse(model, parts, onChunk);
}

// ---------------------------------------------------------------------------
// 4. Background-script-safe version
//    Chrome MV3 content scripts can't always fetch cross-origin. If you route
//    Gemini calls through the background service worker via chrome.runtime
//    messaging, use these serialisable request / response types and call
//    geminiService from background/index.ts instead.
// ---------------------------------------------------------------------------

export type GeminiRequestType = "screenshot" | "liveFrame" | "question";

export interface GeminiBackgroundRequest {
  type: GeminiRequestType;
  imageDataUrl?: string;
  question?: string;
  context?: string;
}

// In background/index.ts, wire this up like:
//
//   import { handleGeminiBackgroundRequest } from "../shared/geminiService";
//
//   chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
//     if (message.type === "GEMINI_QUERY") {
//       handleGeminiBackgroundRequest(message.payload, (chunk) => {
//         // stream chunks back — use a port for true streaming,
//         // or collect and sendResponse at the end for simplicity
//         sendResponse(chunk);
//       });
//       return true; // keep channel open for async sendResponse
//     }
//   });

export async function handleGeminiBackgroundRequest(
  request: GeminiBackgroundRequest,
  onChunk: StreamCallback
): Promise<void> {
  switch (request.type) {
    case "screenshot":
      if (!request.imageDataUrl) throw new Error("imageDataUrl required for screenshot");
      await analyzeScreenshot(request.imageDataUrl, request.question ?? "", onChunk);
      break;

    case "liveFrame":
      // Single-frame version for background routing — live sessions run
      // in the content script where MediaStream is accessible
      if (!request.imageDataUrl) throw new Error("imageDataUrl required for liveFrame");
      await analyzeScreenshot(request.imageDataUrl, "What do you see on screen right now?", onChunk);
      break;

    case "question":
      if (!request.question) throw new Error("question required");
      await askQuestion(request.question, onChunk, request.context);
      break;

    default:
      throw new Error(`Unknown Gemini request type: ${(request as GeminiBackgroundRequest).type}`);
  }
}