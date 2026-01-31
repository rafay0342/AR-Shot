
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, Type } from "@google/genai";
import { StrategicHint, AiResponse, DebugInfo, TargetCandidate } from "../types";

// Always initialize the client with the required object format using process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_NAME = "gemini-3-flash-preview";

export const getStrategicHint = async (
  imageBase64: string,
  validTargets: TargetCandidate[], // Now contains candidates for ALL colors
  dangerRow: number
): Promise<AiResponse> => {
  const startTime = performance.now();
  
  // Default debug info container
  const debug: DebugInfo = {
    latency: 0,
    screenshotBase64: imageBase64, // Keep the raw input for display
    promptContext: "",
    rawResponse: "",
    timestamp: new Date().toLocaleTimeString()
  };

  // Local Heuristic Fallback
  const getBestLocalTarget = (msg: string = "No clear shots—play defensively."): StrategicHint => {
    if (validTargets.length > 0) {
        // Prioritize Bombs/Rainbows first, then Score/Height
        const best = validTargets.sort((a,b) => {
            if (a.powerUp === 'bomb') return -1;
            if (b.powerUp === 'bomb') return 1;
            if (a.powerUp === 'rainbow') return -1;
            if (b.powerUp === 'rainbow') return 1;

            const scoreA = a.size * a.pointsPerBubble;
            const scoreB = b.size * b.pointsPerBubble;
            // Primary: Score
            if (scoreB !== scoreA) return scoreB - scoreA;
            // Secondary: Height (Lower row index is higher on board)
            return a.row - b.row; 
        })[0];
        
        let message = `Fallback: Select ${best.color.toUpperCase()} at Row ${best.row}`;
        if (best.powerUp === 'bomb') message = "Fallback: TRIGGER BOMB!";
        
        return {
            message,
            rationale: "Selected based on value and strategic priority.",
            targetRow: best.row,
            targetCol: best.col,
            recommendedColor: best.color as any
        };
    }
    return { message: msg, rationale: "No valid clusters found to target." };
  };

  const hasDirectTargets = validTargets.length > 0;

  const targetListStr = hasDirectTargets 
    ? validTargets.map(t => {
        let special = "";
        if (t.powerUp === 'bomb') special = " [!!! BOMB TARGET !!!] Hits here clear area.";
        if (t.powerUp === 'rainbow') special = " [RAINBOW] Matches any color.";
        return `- OPTION: Select ${t.color.toUpperCase()} (${t.pointsPerBubble} pts/bubble) -> Target [Row ${t.row}, Col ${t.col}]. Cluster Size: ${t.size}.${special}`;
      }).join("\n")
    : "NO MATCHES AVAILABLE. Suggest a color to set up a future combo.";
  
  debug.promptContext = targetListStr;

  const prompt = `
    You are a strategic gaming AI analyzing a Bubble Shooter game where the player can CHOOSE their projectile color.
    I have provided a screenshot of the current board and a list of valid targets for all available colors.

    ### GAME STATE
    - Danger Level: ${dangerRow >= 6 ? "CRITICAL (Bubbles near bottom!)" : "Stable"}
    - Coordinate System: Row 0 is the TOP of the board. Row 10+ is the BOTTOM.
    
    ### SCORING RULES
    - Red: 100 pts
    - Blue: 150 pts
    - Green: 200 pts
    - Yellow: 250 pts
    - Purple: 300 pts
    - Orange: 500 pts (High Value Target!)

    ### SPECIAL BUBBLES
    - BOMB: Black bubbles. Hitting them destroys everything nearby. HIGHEST PRIORITY.
    - RAINBOW: Multi-colored. They match ANY color projectile. Great for connecting split clusters.

    ### AVAILABLE MOVES (Validated Clear Shots)
    ${targetListStr}

    ### YOUR TASK
    Analyze the visual board state. 
    1. Choose the BEST color for the player to equip.
    2. Tell them where to shoot that specific color.
    
    Prioritize:
    1. **Survival**: If Danger is CRITICAL, clear lowest bubbles.
    2. **Power-Ups**: Hitting a BOMB is almost always the best move.
    3. **Structure**: Hit high up (low row index) to cause avalanches.
    4. **Score**: High value colors and large clusters.
  `;

  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
    
    let response: any;
    let retries = 3;
    let delay = 1000;

    for (let i = 0; i < retries; i++) {
        try {
            response = await ai.models.generateContent({
              model: MODEL_NAME,
              contents: {
                parts: [
                    { text: prompt },
                    { 
                      inlineData: {
                        mimeType: "image/png",
                        data: cleanBase64
                      } 
                    }
                ]
              },
              config: {
                maxOutputTokens: 512, 
                temperature: 0.4,
                responseMimeType: "application/json",
                // Recommended way is to configure a responseSchema for structured JSON
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    message: { type: Type.STRING, description: 'Short operational directive' },
                    rationale: { type: Type.STRING, description: 'Explanation of choice' },
                    recommendedColor: { type: Type.STRING, description: 'Best color for this move' },
                    targetRow: { type: Type.INTEGER, description: 'Target row index' },
                    targetCol: { type: Type.INTEGER, description: 'Target column index' }
                  },
                  required: ["message", "rationale", "recommendedColor", "targetRow", "targetCol"]
                }
              }
            });
            break; 
        } catch (err: any) {
            let status: any = err.status || err.response?.status;
            let msg = err.message || '';
            if (err && typeof err === 'object' && err.error) {
                status = status || err.error.code;
                if (!status && err.error.status) status = err.error.status;
                msg = msg || err.error.message || '';
            }
            const errStr = JSON.stringify(err);
            const isQuota = status === 429 || msg.includes('429') || msg.includes('Quota') || msg.includes('RESOURCE_EXHAUSTED') || errStr.includes('RESOURCE_EXHAUSTED');
            const isOverloaded = status === 503 || msg.includes('503') || msg.includes('overloaded') || msg.includes('UNAVAILABLE') || errStr.includes('UNAVAILABLE');

            if (isQuota || isOverloaded) {
                console.warn(`Gemini Service Issue (${status}). Switching to local fallback.`);
                return {
                    hint: getBestLocalTarget(isOverloaded ? "⚠️ Service Busy: Using Local Strategy" : "⚠️ Offline Mode: Quota Exceeded"),
                    debug: { ...debug, error: `${status || 'Error'}: Service Unavailable` }
                };
            }

            console.warn(`Gemini Attempt ${i+1} failed:`, err);
            if (i === retries - 1) throw err;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2; 
        }
    }

    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    
    // Use .text property directly, not as a method.
    let text = response.text || "{}";
    debug.rawResponse = text;
    
    try {
        const json = JSON.parse(text);
        debug.parsedResponse = json;
        
        const r = Number(json.targetRow);
        const c = Number(json.targetCol);
        
        if (!isNaN(r) && !isNaN(c) && json.recommendedColor) {
            return {
                hint: {
                    message: json.message || "Good shot available!",
                    rationale: json.rationale,
                    targetRow: r,
                    targetCol: c,
                    recommendedColor: json.recommendedColor.toLowerCase() as any
                },
                debug
            };
        }
        return {
            hint: getBestLocalTarget("AI returned invalid coordinates"),
            debug: { ...debug, error: "Invalid Coordinates in JSON" }
        };

    } catch (e: any) {
        console.warn("Failed to parse Gemini JSON:", text);
        return {
            hint: getBestLocalTarget("AI response parse error"),
            debug: { ...debug, error: `JSON Parse Error: ${e.message}` }
        };
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    return {
        hint: getBestLocalTarget("AI Service Unreachable"),
        debug: { ...debug, error: error.message || "Unknown API Error" }
    };
  }
};
