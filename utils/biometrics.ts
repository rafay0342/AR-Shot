/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HandGeometry, VoicePrint } from "../types";

// --- HAND BIOMETRICS ---

const distance = (p1: any, p2: any) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
};

/**
 * Generates a unique, privacy-preserving hash of the hand structure.
 * We calculate invariant ratios (e.g., Index Finger Length / Palm Width).
 * This allows matching a hand regardless of distance from camera.
 */
export const generateHandSignature = (landmarks: any[]): HandGeometry | null => {
  if (!landmarks || landmarks.length < 21) return null;

  // Reference: Palm Width (Wrist 0 -> Index MCP 5 -> Pinky MCP 17)
  // We use 5-17 distance as the base normalization unit
  const palmWidth = distance(landmarks[5], landmarks[17]);
  if (palmWidth === 0) return null;

  const ratios: number[] = [];

  // Finger Lengths relative to Palm Width
  // Thumb (2-4), Index (5-8), Middle (9-12), Ring (13-16), Pinky (17-20)
  const fingers = [[2,4], [5,8], [9,12], [13,16], [17,20]];
  
  fingers.forEach(([start, end]) => {
    const len = distance(landmarks[start], landmarks[end]);
    ratios.push(parseFloat((len / palmWidth).toFixed(4)));
  });

  // Calculate a "Hash" string
  const hash = btoa(ratios.join('|')); // Simple encoding for demo purposes

  return {
    id: hash,
    ratios,
    confidence: 1.0
  };
};

/**
 * Compares two hand signatures.
 * Returns similarity score (0.0 to 1.0).
 */
export const verifyHand = (stored: HandGeometry, current: HandGeometry): number => {
  if (stored.ratios.length !== current.ratios.length) return 0;

  let totalDiff = 0;
  for (let i = 0; i < stored.ratios.length; i++) {
    totalDiff += Math.abs(stored.ratios[i] - current.ratios[i]);
  }

  // Lower difference is better. Average difference > 0.2 means mismatch.
  const avgDiff = totalDiff / stored.ratios.length;
  return Math.max(0, 1 - (avgDiff * 5)); // Scaling factor
};


// --- VOICE BIOMETRICS ---

/**
 * Analyzes an audio buffer to create a spectral signature.
 * Focuses on pitch and dominant frequencies.
 */
export const generateVoicePrint = async (audioBlob: Blob, phrase: string): Promise<VoicePrint> => {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  const analyser = offlineCtx.createAnalyser();
  analyser.fftSize = 256; 
  source.connect(analyser);
  analyser.connect(offlineCtx.destination);

  source.start(0);
  await offlineCtx.startRendering();

  // Extract frequency data
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dataArray);

  // Normalize and simplify signature (taking top 20 frequency bands)
  const signature = Array.from(dataArray).slice(0, 20).map(v => v / 255);

  return {
    signature,
    phrase
  };
};

/**
 * Verifies voice by comparing spectral distance.
 */
export const verifyVoice = (stored: VoicePrint, current: VoicePrint): boolean => {
  // 1. Check Phrase (Simplified check)
  if (stored.phrase.toLowerCase().replace(/[^a-z]/g, '') !== current.phrase.toLowerCase().replace(/[^a-z]/g, '')) {
      return false; 
  }

  // 2. Check Audio Signature (Euclidean Distance)
  let sumSq = 0;
  for (let i = 0; i < Math.min(stored.signature.length, current.signature.length); i++) {
      sumSq += Math.pow(stored.signature[i] - current.signature[i], 2);
  }
  const distance = Math.sqrt(sumSq);
  
  // Threshold for match
  return distance < 1.5; 
};