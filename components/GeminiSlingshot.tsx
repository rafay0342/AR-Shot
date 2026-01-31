
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getStrategicHint } from '../services/geminiService';
import { TargetCandidate, Point, Bubble, Particle, BubbleColor, DebugInfo, UserProfile, UserRole, HandGeometry, VoicePrint } from '../types';
import { Loader2, Trophy, BrainCircuit, Play, MousePointerClick, Eye, Terminal, Target, Lightbulb, Monitor, ShieldAlert, RotateCcw, Flame, Zap, Sparkles, Fingerprint, Lock, Mic, ShieldCheck, UserCheck, ScanFace, Power, AlertTriangle, RefreshCw } from 'lucide-react';
import { SoundEffects } from '../utils/audio';
import { HandStabilizer } from '../utils/physics';
import { generateHandSignature, verifyHand, generateVoicePrint, verifyVoice } from '../utils/biometrics';

// --- Configuration Constants ---
const PINCH_THRESHOLD = 0.08; 
const GRAVITY = 0.0; 
const FRICTION = 0.998; 
const BUBBLE_RADIUS = 22;
const ROW_HEIGHT = BUBBLE_RADIUS * Math.sqrt(3);
const GRID_COLS = 12;
const MAX_ROWS_LIMIT = 11;
const SLINGSHOT_BOTTOM_OFFSET = 220;
const MAX_DRAG_DIST = 180;
const MIN_FORCE_MULT = 0.15;
const MAX_FORCE_MULT = 0.45;
const SMOOTHING_FACTOR = 0.2; 
const SPRITE_SCALE = 3.0; 

// --- Difficulty Configuration ---
type DifficultyLevel = 'Easy' | 'Medium' | 'Hard';

interface DifficultySettings {
    rows: number;
    dropInterval: number;
    aiFrequency: number;
    guideLength: number;
    label: string;
    color: string;
}

const DIFFICULTIES: Record<DifficultyLevel, DifficultySettings> = {
    Easy:   { rows: 3, dropInterval: 8, aiFrequency: 1, guideLength: 60, label: 'Easy',   color: '#66bb6a' },
    Medium: { rows: 5, dropInterval: 6, aiFrequency: 1, guideLength: 40, label: 'Medium', color: '#ffee58' },
    Hard:   { rows: 6, dropInterval: 4, aiFrequency: 2, guideLength: 15, label: 'Hard',   color: '#ef5350' }
};

const COLOR_CONFIG: Record<BubbleColor, { hex: string, points: number, label: string }> = {
  red:    { hex: '#ef5350', points: 100, label: 'Red' },    
  blue:   { hex: '#42a5f5', points: 150, label: 'Blue' },   
  green:  { hex: '#66bb6a', points: 200, label: 'Green' },  
  yellow: { hex: '#ffee58', points: 250, label: 'Yellow' }, 
  purple: { hex: '#ab47bc', points: 300, label: 'Purple' }, 
  orange: { hex: '#ffa726', points: 500, label: 'Orange' }  
};

const COLOR_KEYS: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

const adjustColor = (color: string, amount: number) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
    return "#" + (r.toString(16).length===1?"0"+r.toString(16):r.toString(16)) + (g.toString(16).length===1?"0"+g.toString(16):g.toString(16)) + (b.toString(16).length===1?"0"+b.toString(16):b.toString(16));
};

// --- Helper Functions ---
const isNeighbor = (b1: Bubble, b2: Bubble): boolean => {
    const dist = Math.sqrt(Math.pow(b1.x - b2.x, 2) + Math.pow(b1.y - b2.y, 2));
    return dist < BUBBLE_RADIUS * 2.2; // Slightly larger than diameter to catch adjacencies
};

// --- App State Types ---
type AppState = 'BOOT' | 'HAND_SCAN' | 'VOICE_VERIFY' | 'GAME_LOBBY' | 'PLAYING';

const REQUIRED_PHRASE = "My name is Rafay and I approved";

const GeminiSlingshot: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);
  
  // Game Refs
  const ballPos = useRef<Point>({ x: 0, y: 0 });
  const ballVel = useRef<Point>({ x: 0, y: 0 });
  const anchorPos = useRef<Point>({ x: 0, y: 0 });
  const isPinching = useRef<boolean>(false);
  const isMouseDragging = useRef<boolean>(false);
  const isFlying = useRef<boolean>(false);
  const flightStartTime = useRef<number>(0);
  const bubbles = useRef<Bubble[]>([]);
  const particles = useRef<Particle[]>([]);
  const scoreRef = useRef<number>(0);
  const smoothedHandPos = useRef<Point | null>(null);
  const logicalWidth = useRef<number>(1000);
  const logicalHeight = useRef<number>(800);
  const bubbleSprites = useRef<Record<string, HTMLCanvasElement>>({});
  const aimTargetRef = useRef<Point | null>(null);
  const isAiThinkingRef = useRef<boolean>(false);
  const captureRequestRef = useRef<boolean>(false);
  const selectedColorRef = useRef<BubbleColor>('red');
  
  // Physics & Security Refs
  const stabilizer = useRef<HandStabilizer>(new HandStabilizer());
  const currentUserRef = useRef<UserProfile | null>(null);
  const scanningFrames = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // React State
  const [appState, setAppState] = useState<AppState>('BOOT');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("System Standby");
  const [scanProgress, setScanProgress] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [permissionError, setPermissionError] = useState<{ type: 'camera' | 'microphone', message: string } | null>(null);
  
  const [aiHint, setAiHint] = useState<string | null>("Secure Handshake Required");
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aimTarget, setAimTarget] = useState<Point | null>(null);
  const [score, setScore] = useState(0);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedColor, setSelectedColor] = useState<BubbleColor>('red');
  const [availableColors, setAvailableColors] = useState<BubbleColor[]>([]);
  const [aiRecommendedColor, setAiRecommendedColor] = useState<BubbleColor | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [totalShots, setTotalShots] = useState(0);

  // Difficulty & Progression State
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('Medium');
  const [shotsUntilDrop, setShotsUntilDrop] = useState(DIFFICULTIES.Medium.dropInterval);
  const [gameOver, setGameOver] = useState(false);

  // Game Loop Refs
  const difficultyRef = useRef<DifficultyLevel>('Medium');
  const shotsUntilDropRef = useRef<number>(DIFFICULTIES.Medium.dropInterval);
  const totalShotsRef = useRef<number>(0);
  const gameOverRef = useRef<boolean>(false);

  // Sync state to ref
  useEffect(() => { selectedColorRef.current = selectedColor; }, [selectedColor]);
  useEffect(() => { aimTargetRef.current = aimTarget; }, [aimTarget]);
  useEffect(() => { isAiThinkingRef.current = isAiThinking; }, [isAiThinking]);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
  useEffect(() => { gameOverRef.current = gameOver; }, [gameOver]);

  // --- BOOT SEQUENCE ---
  useEffect(() => {
    // Determine initial status based on local storage
    const storedOwner = localStorage.getItem('GEMINI_OWNER_PROFILE');
    if (!storedOwner) {
        setStatusMessage("SYSTEM INITIALIZATION REQUIRED");
    } else {
        setStatusMessage("SECURE BOOT READY");
    }
  }, []);

  const handleSystemStart = async () => {
    try {
        setLoading(true);
        setPermissionError(null);
        setStatusMessage("REQUESTING OPTICAL ACCESS...");

        // Safe Audio Init
        SoundEffects.init();

        // Cleanup existing streams if any (defensive)
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }

        // Explicitly request permission within user gesture to satisfy browser security policies.
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1280 }, 
                height: { ideal: 720 },
                facingMode: 'user'
            } 
        });
        
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.muted = true;
            videoRef.current.playsInline = true;
            
            try {
                if (videoRef.current.paused) {
                    await videoRef.current.play();
                }
            } catch (playErr) {
                console.warn("Video play() failed, relying on autoplay attribute:", playErr);
            }
        }
        
        const storedOwner = localStorage.getItem('GEMINI_OWNER_PROFILE');
        if (!storedOwner) {
            setStatusMessage("INITIALIZING OWNER REGISTRATION PROTOCOL");
            setAppState('HAND_SCAN');
        } else {
            setStatusMessage("BIOMETRIC VERIFICATION REQUIRED");
            setAppState('HAND_SCAN');
        }
    } catch (err: any) {
        console.error("Camera permission denied", err);
        setPermissionError({
            type: 'camera',
            message: err.name === 'NotAllowedError' 
                ? "Camera access was denied. Please update your browser settings to allow access to the camera." 
                : "Unable to access camera. Ensure it is not in use by another application."
        });
        setLoading(false);
    }
  };

  // --- SPRITE & GAME INIT ---
  const generateSprites = () => {
    const sprites: Record<string, HTMLCanvasElement> = {};
    const size = BUBBLE_RADIUS * SPRITE_SCALE; 
    COLOR_KEYS.forEach(key => {
        const c = document.createElement('canvas');
        c.width = size * 2; c.height = size * 2;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const config = COLOR_CONFIG[key];
        const cx = size; const cy = size; const r = size - (2 * SPRITE_SCALE); 
        const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
        grad.addColorStop(0, adjustColor(config.hex, 30)); grad.addColorStop(0.4, config.hex);          
        grad.addColorStop(0.85, adjustColor(config.hex, -40)); grad.addColorStop(1, adjustColor(config.hex, -90)); 
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4 * SPRITE_SCALE; ctx.shadowOffsetY = 2 * SPRITE_SCALE;
        ctx.fill(); ctx.shadowColor = 'transparent'; 
        const innerGlow = ctx.createRadialGradient(cx, cy + r*0.6, r*0.2, cx, cy, r);
        innerGlow.addColorStop(0, adjustColor(config.hex, 60)); innerGlow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = innerGlow; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1 * SPRITE_SCALE; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.4, r * 0.25, Math.PI / 4, 0, Math.PI * 2);
        const shineGrad = ctx.createLinearGradient(cx - r, cy - r, cx, cy); shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)'); shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = shineGrad; ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0.7 * Math.PI, 2.3 * Math.PI, true); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 3 * SPRITE_SCALE; ctx.lineCap = 'round'; ctx.stroke();
        sprites[key] = c;
    });
    const bombC = document.createElement('canvas'); bombC.width = size * 2; bombC.height = size * 2;
    const bCtx = bombC.getContext('2d');
    if (bCtx) {
        const cx = size; const cy = size; const r = size - (2 * SPRITE_SCALE);
        const grad = bCtx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
        grad.addColorStop(0, '#555'); grad.addColorStop(1, '#111');
        bCtx.beginPath(); bCtx.arc(cx, cy, r, 0, Math.PI*2); bCtx.fillStyle = grad; bCtx.fill();
        bCtx.beginPath(); bCtx.moveTo(cx + r*0.5, cy - r*0.5); bCtx.quadraticCurveTo(cx + r*0.8, cy - r*0.8, cx + r, cy - r*1.2); bCtx.strokeStyle = '#d7ccc8'; bCtx.lineWidth = 4 * SPRITE_SCALE; bCtx.stroke();
        bCtx.beginPath(); bCtx.arc(cx + r, cy - r*1.2, 5 * SPRITE_SCALE, 0, Math.PI*2); bCtx.fillStyle = '#ff5722'; bCtx.fill();
    }
    sprites['bomb'] = bombC;
    bubbleSprites.current = sprites;
  };
  
  const getBubblePos = (row: number, col: number, width: number) => {
    const xOffset = (width - (GRID_COLS * BUBBLE_RADIUS * 2)) / 2 + BUBBLE_RADIUS;
    const isOdd = row % 2 !== 0;
    const x = xOffset + col * (BUBBLE_RADIUS * 2) + (isOdd ? BUBBLE_RADIUS : 0);
    const y = BUBBLE_RADIUS + row * ROW_HEIGHT;
    return { x, y };
  };

  const updateAvailableColors = () => {
    const activeColors = new Set<BubbleColor>();
    bubbles.current.forEach(b => { if (b.active) activeColors.add(b.color); });
    setAvailableColors(Array.from(activeColors));
    if (!activeColors.has(selectedColorRef.current) && activeColors.size > 0) {
        setSelectedColor(Array.from(activeColors)[0]);
    }
  };

  const createBubble = (row: number, col: number, width: number): Bubble => {
      const { x, y } = getBubblePos(row, col, width);
      const rand = Math.random();
      let powerUp: 'bomb' | 'rainbow' | undefined = undefined;
      if (rand < 0.03) powerUp = 'bomb'; else if (rand < 0.05) powerUp = 'rainbow';
      return { id: `${row}-${col}-${Date.now()}-${Math.random()}`, row, col, x, y, color: COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)], active: true, powerUp };
  };

  const initGrid = useCallback((width: number, level: DifficultyLevel) => {
    const config = DIFFICULTIES[level];
    const newBubbles: Bubble[] = [];
    for (let r = 0; r < config.rows; r++) { 
      for (let c = 0; c < (r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS); c++) {
        if (Math.random() > 0.1) newBubbles.push(createBubble(r, c, width));
      }
    }
    bubbles.current = newBubbles;
    updateAvailableColors();
    setShotsUntilDrop(config.dropInterval); setGameOver(false); setScore(0); setTotalShots(0);
    shotsUntilDropRef.current = config.dropInterval; totalShotsRef.current = 0; gameOverRef.current = false; scoreRef.current = 0; difficultyRef.current = level;
    setTimeout(() => { captureRequestRef.current = true; }, 2000);
  }, []);

  const addCeilingRow = () => {
      let maxRow = 0;
      bubbles.current.forEach(b => {
          if (b.active) {
              b.row += 1;
              const { x, y } = getBubblePos(b.row, b.col, logicalWidth.current);
              b.x = x; b.y = y;
              if (b.row > maxRow) maxRow = b.row;
          }
      });
      for (let c = 0; c < GRID_COLS; c++) bubbles.current.push(createBubble(0, c, logicalWidth.current));
      if (maxRow >= MAX_ROWS_LIMIT) { setGameOver(true); gameOverRef.current = true; SoundEffects.miss(); } else { SoundEffects.bounce(); }
      updateAvailableColors();
  };

  const triggerBomb = (bomb: Bubble) => {
      const explosionRadius = BUBBLE_RADIUS * 3.5;
      let destroyed = 0;
      bubbles.current.forEach(b => {
          if (!b.active) return;
          const dist = Math.sqrt((b.x - bomb.x)**2 + (b.y - bomb.y)**2);
          if (dist <= explosionRadius) { b.active = false; createExplosion(b.x, b.y, b.color); destroyed++; }
      });
      SoundEffects.explode();
      scoreRef.current += destroyed * 50;
      setScore(scoreRef.current);
  };

  const handleDifficultyChange = (newDiff: DifficultyLevel) => {
      setDifficulty(newDiff);
      initGrid(logicalWidth.current, newDiff);
  };

  const restartGame = () => {
      initGrid(logicalWidth.current, difficulty);
  };

  // --- Hand Interactions ---
  const handleStart = (clientX: number, clientY: number) => {
    SoundEffects.init(); 
    if (isFlying.current || isAiThinkingRef.current || gameOverRef.current || appState !== 'PLAYING') return;
    const rect = gameContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (Math.sqrt(Math.pow(x - ballPos.current.x, 2) + Math.pow(y - ballPos.current.y, 2)) < BUBBLE_RADIUS * 3) {
      isMouseDragging.current = true;
    }
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isMouseDragging.current || gameOverRef.current) return;
    const rect = gameContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let dragDx = x - anchorPos.current.x;
    let dragDy = y - anchorPos.current.y;
    const dragDist = Math.sqrt(dragDx*dragDx + dragDy*dragDy);
    if (dragDist > MAX_DRAG_DIST) {
        const angle = Math.atan2(dragDy, dragDx);
        dragDx = Math.cos(angle) * MAX_DRAG_DIST; dragDy = Math.sin(angle) * MAX_DRAG_DIST;
        ballPos.current = { x: anchorPos.current.x + dragDx, y: anchorPos.current.y + dragDy };
    } else {
        ballPos.current = { x, y };
    }
  };

  const handleEnd = () => {
    if (!isMouseDragging.current || gameOverRef.current) return;
    isMouseDragging.current = false;
    const dx = anchorPos.current.x - ballPos.current.x;
    const dy = anchorPos.current.y - ballPos.current.y;
    const stretchDist = Math.sqrt(dx*dx + dy*dy);
    if (stretchDist > 30) {
        isFlying.current = true; SoundEffects.shoot(); flightStartTime.current = performance.now();
        const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0);
        const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);
        ballVel.current = { x: dx * velocityMultiplier, y: dy * velocityMultiplier };
    } 
  };

  // --- Voice Auth Logic ---
  const startRecording = async () => {
    try {
      setPermissionError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const print = await generateVoicePrint(audioBlob, REQUIRED_PHRASE);
        
        const storedOwnerStr = localStorage.getItem('GEMINI_OWNER_PROFILE');
        
        if (!storedOwnerStr) {
            // New Owner
            const updatedProfile = { ...currentUserRef.current!, voicePrint: print };
            localStorage.setItem('GEMINI_OWNER_PROFILE', JSON.stringify(updatedProfile));
            currentUserRef.current = updatedProfile;
            setStatusMessage("OWNER VOICEPRINT ENCRYPTED & SAVED");
            setTimeout(() => setAppState('GAME_LOBBY'), 1500);
        } else {
            // Verify
            const storedOwner = JSON.parse(storedOwnerStr) as UserProfile;
            if (verifyVoice(storedOwner.voicePrint!, print)) {
                setStatusMessage("VOICE MATCH CONFIRMED. WELCOME, RAFAY.");
                setTimeout(() => setAppState('GAME_LOBBY'), 1500);
            } else {
                setStatusMessage("VOICE MISMATCH. ACCESS DENIED.");
            }
        }
        setIsRecording(false);
        // Stop all tracks to release mic
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      setIsRecording(true);
      
      // Auto stop after 4 seconds
      setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
      }, 4000);

    } catch (err: any) {
      console.error(err);
      setPermissionError({
        type: 'microphone',
        message: err.name === 'NotAllowedError' 
            ? "Microphone access was denied. Please allow microphone access in your browser settings to proceed." 
            : "Unable to access microphone. Please check your hardware or site permissions."
      });
      setStatusMessage("MICROPHONE ACCESS FAILED");
    }
  };

  // ... (Physics and Rendering logic similar to before, wrapped in useEffect) ...
  const createExplosion = (x: number, y: number, colorKey: BubbleColor) => {
    const config = COLOR_CONFIG[colorKey];
    const baseColor = config.hex;
    particles.current.push({ x, y, vx: 0, vy: 0, life: 1.0, color: baseColor, size: BUBBLE_RADIUS, type: 'ring' });
    let debrisCount = 8; let speedMult = 1.0; let particleType: 'circle' | 'star' = 'circle';
    if (colorKey === 'red' || colorKey === 'orange') { debrisCount = 12; speedMult = 1.2; } else if (colorKey === 'blue' || colorKey === 'purple') { particleType = 'star'; }
    for (let i = 0; i < debrisCount; i++) {
        const angle = Math.random() * Math.PI * 2; const speed = (Math.random() * 8 + 4) * speedMult;
        particles.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1.0, color: baseColor, size: 6 + Math.random() * 6, type: particleType });
    }
    for (let i = 0; i < 6; i++) { particles.current.push({ x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, life: 1.2, color: '#fff', size: 4 + Math.random() * 4, type: 'star' }); }
    if (colorKey === 'green') { for(let i=0; i<4; i++) { particles.current.push({ x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5), vy: -1 - Math.random(), life: 1.5, color: adjustColor(baseColor, 40), size: 4, type: 'circle' }); } }
  };

  const isPathClear = (target: Bubble) => {
    if (!anchorPos.current) return false;
    const startX = anchorPos.current.x; const startY = anchorPos.current.y;
    const endX = target.x; const endY = target.y;
    const dx = endX - startX; const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance / (BUBBLE_RADIUS / 2)); 
    for (let i = 1; i < steps - 2; i++) { 
        const t = i / steps; const cx = startX + dx * t; const cy = startY + dy * t;
        for (const b of bubbles.current) {
            if (!b.active || b.id === target.id) continue;
            const distSq = Math.pow(cx - b.x, 2) + Math.pow(cy - b.y, 2);
            if (distSq < Math.pow(BUBBLE_RADIUS * 1.8, 2)) return false; 
        }
    }
    return true;
  };

  const getAllReachableClusters = (): TargetCandidate[] => {
    const activeBubbles = bubbles.current.filter(b => b.active);
    const uniqueColors = Array.from(new Set(activeBubbles.map(b => b.color))) as BubbleColor[];
    const allClusters: TargetCandidate[] = [];
    for (const color of uniqueColors) {
        const visited = new Set<string>();
        for (const b of activeBubbles) {
            if (b.powerUp === 'bomb' && !visited.has(b.id)) {
                if (isPathClear(b)) {
                    allClusters.push({ id: b.id, color: 'red', size: 10, row: b.row, col: b.col, pointsPerBubble: 500, description: 'BOMB', powerUp: 'bomb' });
                    visited.add(b.id);
                }
                continue;
            }
            if (b.color !== color || visited.has(b.id)) continue;
            const clusterMembers: Bubble[] = []; const queue = [b]; visited.add(b.id); let hasRainbow = false;
            while (queue.length > 0) {
                const curr = queue.shift()!; clusterMembers.push(curr);
                const neighbors = activeBubbles.filter(n => !visited.has(n.id) && (n.color === color || n.powerUp === 'rainbow') && isNeighbor(curr, n));
                neighbors.forEach(n => { visited.add(n.id); queue.push(n); if (n.powerUp === 'rainbow') hasRainbow = true; });
            }
            clusterMembers.sort((a,b) => b.y - a.y); const hittableMember = clusterMembers.find(m => isPathClear(m));
            if (hittableMember) {
                const xPct = hittableMember.x / logicalWidth.current;
                let desc = xPct < 0.33 ? "Left" : xPct > 0.66 ? "Right" : "Center";
                allClusters.push({ id: hittableMember.id, color: color, size: clusterMembers.length, row: hittableMember.row, col: hittableMember.col, pointsPerBubble: COLOR_CONFIG[color].points, description: `${desc}`, powerUp: hasRainbow ? 'rainbow' : undefined });
            }
        }
    }
    return allClusters;
  };

  const checkMatches = (startBubble: Bubble) => {
    const toCheck = [startBubble]; const visited = new Set<string>(); const matches: Bubble[] = []; const targetColor = startBubble.color;
    while (toCheck.length > 0) {
      const current = toCheck.pop()!; if (visited.has(current.id)) continue; visited.add(current.id);
      if (current.color === targetColor || current.powerUp === 'rainbow') {
        matches.push(current); const neighbors = bubbles.current.filter(b => b.active && !visited.has(b.id) && isNeighbor(current, b)); toCheck.push(...neighbors);
      }
    }
    if (matches.length >= 3) {
      let points = 0; const basePoints = COLOR_CONFIG[targetColor].points;
      if (matches.length >= 5) { SoundEffects.chainReaction(); } else { SoundEffects.pop(matches.length); }
      matches.forEach(b => { b.active = false; createExplosion(b.x, b.y, b.color); points += basePoints; });
      const multiplier = matches.length > 3 ? 1.5 : 1.0; scoreRef.current += Math.floor(points * multiplier); setScore(scoreRef.current);
      return true;
    }
    return false;
  };

  const performAiAnalysis = async (screenshot: string) => {
    isAiThinkingRef.current = true; setIsAiThinking(true); setAiHint("Analyzing tactical options..."); setAiRationale(null); setAiRecommendedColor(null); setAimTarget(null);
    const allClusters = getAllReachableClusters();
    const maxRow = bubbles.current.reduce((max, b) => b.active ? Math.max(max, b.row) : max, 0);
    getStrategicHint(screenshot, allClusters, maxRow).then(aiResponse => {
        const { hint, debug } = aiResponse; setDebugInfo(debug); setAiHint(hint.message); setAiRationale(hint.rationale || null);
        if (typeof hint.targetRow === 'number' && typeof hint.targetCol === 'number') {
            if (hint.recommendedColor) { setAiRecommendedColor(hint.recommendedColor); setSelectedColor(hint.recommendedColor); }
            const pos = getBubblePos(hint.targetRow, hint.targetCol, logicalWidth.current); setAimTarget(pos);
        }
        isAiThinkingRef.current = false; setIsAiThinking(false);
    });
  };

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !gameContainerRef.current) return;
    
    // Do not initialize Game if in BOOT state
    if (appState === 'BOOT') return;

    generateSprites();
    const canvas = canvasRef.current; const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { alpha: false }); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const updateDimensions = () => {
        logicalWidth.current = container.clientWidth; logicalHeight.current = container.clientHeight;
        canvas.width = logicalWidth.current * dpr; canvas.height = logicalHeight.current * dpr;
        canvas.style.width = `${logicalWidth.current}px`; canvas.style.height = `${logicalHeight.current}px`;
        ctx.scale(dpr, dpr);
        anchorPos.current = { x: logicalWidth.current / 2, y: logicalHeight.current - SLINGSHOT_BOTTOM_OFFSET };
        if (!isFlying.current && !isPinching.current && !isMouseDragging.current) { ballPos.current = { ...anchorPos.current }; }
    };
    updateDimensions();
    initGrid(logicalWidth.current, 'Medium');

    let hands: any = null;

    const onResults = (results: any) => {
      setLoading(false);
      
      const vRatio = results.image.width / results.image.height; const cRatio = logicalWidth.current / logicalHeight.current;
      let drawW, drawH, startX, startY;
      if (vRatio > cRatio) { drawH = logicalHeight.current; drawW = drawH * vRatio; startX = (logicalWidth.current - drawW) / 2; startY = 0; } 
      else { drawW = logicalWidth.current; drawH = drawW / vRatio; startX = 0; startY = (logicalHeight.current - drawH) / 2; }

      ctx.save(); ctx.translate(logicalWidth.current, 0); ctx.scale(-1, 1);
      // Security Filter: Darken video during scan
      if (appState === 'HAND_SCAN') {
          ctx.filter = "grayscale(100%) contrast(1.2) brightness(0.5)";
      }
      ctx.drawImage(results.image, startX, startY, drawW, drawH);
      ctx.filter = "none";
      ctx.restore();

      // --- STATE MACHINE LOGIC ---
      
      // 1. HAND SCANNING PHASE
      if (appState === 'HAND_SCAN') {
          ctx.fillStyle = 'rgba(0, 255, 100, 0.1)';
          ctx.strokeStyle = '#00ff66';
          
          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
              const landmarks = results.multiHandLandmarks[0];
              const signature = generateHandSignature(landmarks);
              
              if (signature) {
                  scanningFrames.current += 1;
                  setScanProgress(Math.min(100, (scanningFrames.current / 60) * 100)); // 60 frames to scan
                  
                  // Draw Scanning Geometry
                  for (const conn of window.HAND_CONNECTIONS) {
                      const p1 = landmarks[conn[0]]; const p2 = landmarks[conn[1]];
                      const x1 = startX + ((1 - p1.x) * drawW); const y1 = startY + (p1.y * drawH);
                      const x2 = startX + ((1 - p2.x) * drawW); const y2 = startY + (p2.y * drawH);
                      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = 2; ctx.stroke();
                  }

                  if (scanningFrames.current > 60) {
                      const storedOwnerStr = localStorage.getItem('GEMINI_OWNER_PROFILE');
                      if (!storedOwnerStr) {
                          // Register new Owner
                          const newProfile: UserProfile = {
                              id: signature.id,
                              role: 'OWNER',
                              name: 'Rafay (Owner)',
                              handGeometry: signature,
                              createdAt: Date.now()
                          };
                          currentUserRef.current = newProfile;
                          scanningFrames.current = 0;
                          setStatusMessage("HAND GEOMETRY ENCRYPTED. INITIATING VOICE PROTOCOL.");
                          setAppState('VOICE_VERIFY');
                      } else {
                          // Verify
                          const storedOwner = JSON.parse(storedOwnerStr) as UserProfile;
                          const similarity = verifyHand(storedOwner.handGeometry, signature);
                          if (similarity > 0.8) {
                              currentUserRef.current = storedOwner;
                              scanningFrames.current = 0;
                              setStatusMessage("HAND VERIFIED. CONFIRMING VOICEPRINT...");
                              setAppState('VOICE_VERIFY');
                          } else {
                              setStatusMessage("UNAUTHORIZED HAND PATTERN DETECTED");
                              scanningFrames.current = 0;
                          }
                      }
                  }
              }
          }
          return; // Skip game render
      }

      // 2. VOICE PHASE (Overlay Only, no canvas ops needed)
      if (appState === 'VOICE_VERIFY') {
          return;
      }

      // 3. GAMEPLAY PHASE
      if (appState === 'GAME_LOBBY' || appState === 'PLAYING') {
        if (appState === 'GAME_LOBBY') setAppState('PLAYING');

        ctx.fillStyle = 'rgba(18, 18, 18, 0.85)';
        ctx.fillRect(0, 0, logicalWidth.current, logicalHeight.current);

        const dangerY = BUBBLE_RADIUS + MAX_ROWS_LIMIT * ROW_HEIGHT;
        ctx.beginPath(); ctx.moveTo(0, dangerY); ctx.lineTo(logicalWidth.current, dangerY);
        ctx.strokeStyle = 'rgba(239, 83, 80, 0.3)'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); ctx.stroke(); ctx.setLineDash([]);
        
        let pinchDist = 1.0;
        
        if (!gameOverRef.current && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            const idxTip = landmarks[8]; const thumbTip = landmarks[4];
            
            // Physics Stabilization
            const rawX = startX + ((1 - (idxTip.x + thumbTip.x)/2) * drawW);
            const rawY = startY + ((idxTip.y + thumbTip.y)/2) * drawH;
            
            const stabilized = stabilizer.current.update({ x: rawX, y: rawY }, logicalWidth.current, logicalHeight.current);
            const isIntentional = stabilizer.current.isIntentional(landmarks, logicalWidth.current, logicalHeight.current);

            if (stabilized && isIntentional) {
                smoothedHandPos.current = stabilized;
                const ndx = idxTip.x - thumbTip.x; const ndy = idxTip.y - thumbTip.y;
                pinchDist = Math.sqrt(ndx * ndx + ndy * ndy);
                const isPinchingNow = pinchDist < PINCH_THRESHOLD;

                const cursor = smoothedHandPos.current;
                ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 25, 0, Math.PI * 2);
                ctx.strokeStyle = isPinchingNow ? '#66bb6a' : 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 2; ctx.stroke();
                ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = isPinchingNow ? '#66bb6a' : '#ffffff'; ctx.fill();
            }
        } else {
            stabilizer.current.reset(); // Lost tracking
        }
        
        const handPos = smoothedHandPos.current;
        const isLocked = isAiThinkingRef.current;
        const isDragging = isMouseDragging.current;

        if (!isDragging && !gameOverRef.current) {
            if (!isLocked && handPos && pinchDist < PINCH_THRESHOLD && !isFlying.current) {
                const distToBall = Math.sqrt(Math.pow(handPos.x - ballPos.current.x, 2) + Math.pow(handPos.y - ballPos.current.y, 2));
                if (!isPinching.current && distToBall < 120) { isPinching.current = true; }
                if (isPinching.current) {
                    ballPos.current = { x: handPos.x, y: handPos.y };
                    const dragDx = ballPos.current.x - anchorPos.current.x; const dragDy = ballPos.current.y - anchorPos.current.y;
                    const dragDist = Math.sqrt(dragDx*dragDx + dragDy*dragDy);
                    if (dragDist > MAX_DRAG_DIST) {
                        const angle = Math.atan2(dragDy, dragDx);
                        ballPos.current.x = anchorPos.current.x + Math.cos(angle) * MAX_DRAG_DIST;
                        ballPos.current.y = anchorPos.current.y + Math.sin(angle) * MAX_DRAG_DIST;
                    }
                }
            } else if (isPinching.current && (!handPos || pinchDist >= PINCH_THRESHOLD || isLocked)) {
                isPinching.current = false;
                if (isLocked) { ballPos.current = { ...anchorPos.current }; } else {
                    const dx = anchorPos.current.x - ballPos.current.x; const dy = anchorPos.current.y - ballPos.current.y;
                    const stretchDist = Math.sqrt(dx*dx + dy*dy);
                    if (stretchDist > 30) {
                        isFlying.current = true; SoundEffects.shoot(); flightStartTime.current = performance.now();
                        const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0);
                        const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);
                        ballVel.current = { x: dx * velocityMultiplier, y: dy * velocityMultiplier };
                    } else { ballPos.current = { ...anchorPos.current }; }
                }
            }
        }

        if (!isFlying.current && !isPinching.current && !isDragging) {
            const dx = anchorPos.current.x - ballPos.current.x; const dy = anchorPos.current.y - ballPos.current.y;
            ballPos.current.x += dx * 0.15; ballPos.current.y += dy * 0.15;
        }

        // --- Physics Update ---
        if (isFlying.current) {
            // ... (Same Physics Code)
            if (performance.now() - flightStartTime.current > 5000) { isFlying.current = false; ballPos.current = { ...anchorPos.current }; ballVel.current = { x: 0, y: 0 }; } else {
                const currentSpeed = Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2);
                const steps = Math.ceil(currentSpeed / (BUBBLE_RADIUS * 0.8)); let collisionOccurred = false;
                for (let i = 0; i < steps; i++) {
                    ballPos.current.x += ballVel.current.x / steps; ballPos.current.y += ballVel.current.y / steps;
                    if (ballPos.current.x < BUBBLE_RADIUS || ballPos.current.x > logicalWidth.current - BUBBLE_RADIUS) { ballVel.current.x *= -1; ballPos.current.x = Math.max(BUBBLE_RADIUS, Math.min(logicalWidth.current - BUBBLE_RADIUS, ballPos.current.x)); SoundEffects.bounce(); }
                    if (ballPos.current.y < BUBBLE_RADIUS) { collisionOccurred = true; break; }
                    for (const b of bubbles.current) {
                        if (!b.active) continue;
                        const dist = Math.sqrt(Math.pow(ballPos.current.x - b.x, 2) + Math.pow(ballPos.current.y - b.y, 2));
                        if (dist < BUBBLE_RADIUS * 1.8) { 
                            if (b.powerUp === 'bomb') { triggerBomb(b); isFlying.current = false; ballPos.current = { ...anchorPos.current }; ballVel.current = { x: 0, y: 0 }; return; }
                            collisionOccurred = true; break; 
                        }
                    }
                    if (collisionOccurred) break;
                }
                ballVel.current.y += GRAVITY; ballVel.current.x *= FRICTION; ballVel.current.y *= FRICTION;
                if (collisionOccurred) {
                    isFlying.current = false;
                    let bestDist = Infinity; let bestRow = 0; let bestCol = 0; let bestX = 0; let bestY = 0;
                    for (let r = 0; r < MAX_ROWS_LIMIT + 5; r++) {
                        const colsInRow = r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS;
                        for (let c = 0; c < colsInRow; c++) {
                            const { x, y } = getBubblePos(r, c, logicalWidth.current); const occupied = bubbles.current.some(b => b.active && b.row === r && b.col === c); if (occupied) continue;
                            const dist = Math.sqrt(Math.pow(ballPos.current.x - x, 2) + Math.pow(ballPos.current.y - y, 2));
                            if (dist < bestDist) { bestDist = dist; bestRow = r; bestCol = c; bestX = x; bestY = y; }
                        }
                    }
                    const newBubble: Bubble = { id: `${bestRow}-${bestCol}-${Date.now()}`, row: bestRow, col: bestCol, x: bestX, y: bestY, color: selectedColorRef.current, active: true };
                    bubbles.current.push(newBubble); const matched = checkMatches(newBubble); if (!matched) { SoundEffects.miss(); } updateAvailableColors();
                    const newTotal = totalShotsRef.current + 1; totalShotsRef.current = newTotal; setTotalShots(newTotal); 
                    let nextDrop = shotsUntilDropRef.current - 1; if (nextDrop <= 0) { addCeilingRow(); const config = DIFFICULTIES[difficultyRef.current]; nextDrop = config.dropInterval; } shotsUntilDropRef.current = nextDrop; setShotsUntilDrop(nextDrop); 
                    if (bestRow >= MAX_ROWS_LIMIT) { setGameOver(true); gameOverRef.current = true; }
                    ballPos.current = { ...anchorPos.current }; ballVel.current = { x: 0, y: 0 };
                    const config = DIFFICULTIES[difficultyRef.current];
                    if (newTotal % config.aiFrequency === 0) { captureRequestRef.current = true; }
                }
                if (ballPos.current.y > logicalHeight.current) { isFlying.current = false; ballPos.current = { ...anchorPos.current }; ballVel.current = { x: 0, y: 0 }; }
            }
        }

        // --- Drawing Bubbles & UI ---
        bubbles.current.forEach(b => {
            if (!b.active) return;
            if (b.powerUp === 'bomb') {
                const sprite = bubbleSprites.current['bomb'];
                if (sprite) {
                    ctx.drawImage(sprite, b.x - BUBBLE_RADIUS, b.y - BUBBLE_RADIUS, BUBBLE_RADIUS * 2, BUBBLE_RADIUS * 2);
                    const pulse = Math.sin(performance.now() / 200) * 0.1 + 1.0;
                    ctx.save(); ctx.translate(b.x, b.y); ctx.scale(pulse, pulse); ctx.globalCompositeOperation = 'overlay'; ctx.beginPath(); ctx.arc(0, 0, BUBBLE_RADIUS * 0.4, 0, Math.PI * 2); ctx.fillStyle = '#ff5252'; ctx.fill(); ctx.restore();
                }
            } else if (b.powerUp === 'rainbow') {
                const time = performance.now(); ctx.save(); ctx.translate(b.x, b.y);
                const grad = ctx.createRadialGradient(-BUBBLE_RADIUS*0.3, -BUBBLE_RADIUS*0.3, BUBBLE_RADIUS*0.1, 0, 0, BUBBLE_RADIUS);
                grad.addColorStop(0, `hsl(${(time / 10) % 360}, 100%, 70%)`); grad.addColorStop(0.5, `hsl(${(time / 10 + 120) % 360}, 100%, 50%)`); grad.addColorStop(1, `hsl(${(time / 10 + 240) % 360}, 100%, 30%)`);
                ctx.beginPath(); ctx.arc(0, 0, BUBBLE_RADIUS, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
                ctx.beginPath(); ctx.ellipse(-BUBBLE_RADIUS * 0.3, -BUBBLE_RADIUS * 0.35, BUBBLE_RADIUS * 0.4, BUBBLE_RADIUS * 0.25, Math.PI / 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fill(); ctx.restore();
            } else {
                const sprite = bubbleSprites.current[b.color]; if (sprite) { ctx.drawImage(sprite, b.x - BUBBLE_RADIUS, b.y - BUBBLE_RADIUS, BUBBLE_RADIUS * 2, BUBBLE_RADIUS * 2); }
            }
        });

        // ... (Laser Sight & Particles - Standard Render)
        const currentAimTarget = aimTargetRef.current; const thinking = isAiThinkingRef.current; const currentSelected = selectedColorRef.current;
        const shouldShowLine = currentAimTarget && !isFlying.current && (!aiRecommendedColor || aiRecommendedColor === currentSelected);
        if (shouldShowLine || thinking) {
            ctx.save(); const highlightColor = thinking ? '#a8c7fa' : COLOR_CONFIG[currentSelected].hex; ctx.shadowBlur = 10; ctx.shadowColor = highlightColor;
            ctx.beginPath(); ctx.moveTo(anchorPos.current.x, anchorPos.current.y);
            if (currentAimTarget) { ctx.lineTo(currentAimTarget.x, currentAimTarget.y); } else { ctx.lineTo(anchorPos.current.x, anchorPos.current.y - 200); }
            const time = performance.now(); const dashOffset = (time / 15) % 30; ctx.setLineDash([20, 15]); ctx.lineDashOffset = -dashOffset; ctx.strokeStyle = thinking ? 'rgba(168, 199, 250, 0.5)' : highlightColor; ctx.lineWidth = 4; ctx.stroke();
            if (currentAimTarget && !thinking) { ctx.beginPath(); ctx.arc(currentAimTarget.x, currentAimTarget.y, BUBBLE_RADIUS, 0, Math.PI * 2); ctx.setLineDash([5, 5]); ctx.strokeStyle = highlightColor; ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fill(); ctx.stroke(); }
            ctx.restore();
        }
        
        const isBandActive = isPinching.current || isDragging; const bandColor = isBandActive ? '#fdd835' : 'rgba(255,255,255,0.4)';
        if (!isFlying.current) { ctx.beginPath(); ctx.moveTo(anchorPos.current.x - 35, anchorPos.current.y - 10); ctx.lineTo(ballPos.current.x, ballPos.current.y); ctx.lineWidth = 5; ctx.strokeStyle = bandColor; ctx.lineCap = 'round'; ctx.stroke(); }

        // Trajectory
        if ((isPinching.current || isMouseDragging.current) && !isFlying.current && !gameOverRef.current) {
            const dx = anchorPos.current.x - ballPos.current.x; const dy = anchorPos.current.y - ballPos.current.y; const stretchDist = Math.sqrt(dx*dx + dy*dy);
            if (stretchDist > 10) {
                const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0); const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);
                let simX = ballPos.current.x; let simY = ballPos.current.y; let simVx = dx * velocityMultiplier; let simVy = dy * velocityMultiplier; let collision = false;
                const diffConfig = DIFFICULTIES[difficultyRef.current]; const maxSteps = diffConfig.guideLength;
                ctx.save(); ctx.beginPath(); ctx.moveTo(simX, simY);
                for (let i = 0; i < maxSteps; i++) {
                    simX += simVx; simY += simVy;
                    if (simX < BUBBLE_RADIUS || simX > logicalWidth.current - BUBBLE_RADIUS) { simVx *= -1; simX = Math.max(BUBBLE_RADIUS, Math.min(logicalWidth.current - BUBBLE_RADIUS, simX)); }
                    if (simY < BUBBLE_RADIUS) { collision = true; }
                    for (const b of bubbles.current) { if (!b.active) continue; const distSq = (simX - b.x)**2 + (simY - b.y)**2; if (distSq < (BUBBLE_RADIUS * 1.8)**2) { collision = true; break; } }
                    ctx.lineTo(simX, simY); if (collision) break; simVy += GRAVITY; simVx *= FRICTION; simVy *= FRICTION;
                }
                ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.restore();
            }
        }

        ctx.save(); if (isLocked && !isFlying.current) { ctx.globalAlpha = 0.5; }
        const activeSprite = bubbleSprites.current[selectedColorRef.current]; if (activeSprite) { ctx.drawImage(activeSprite, ballPos.current.x - BUBBLE_RADIUS, ballPos.current.y - BUBBLE_RADIUS, BUBBLE_RADIUS * 2, BUBBLE_RADIUS * 2); }
        ctx.restore();

        if (!isFlying.current) { ctx.beginPath(); ctx.moveTo(ballPos.current.x, ballPos.current.y); ctx.lineTo(anchorPos.current.x + 35, anchorPos.current.y - 10); ctx.lineWidth = 5; ctx.strokeStyle = bandColor; ctx.lineCap = 'round'; ctx.stroke(); }

        ctx.beginPath(); ctx.moveTo(anchorPos.current.x, logicalHeight.current); ctx.lineTo(anchorPos.current.x, anchorPos.current.y + 40); ctx.lineTo(anchorPos.current.x - 40, anchorPos.current.y); ctx.moveTo(anchorPos.current.x, anchorPos.current.y + 40); ctx.lineTo(anchorPos.current.x + 40, anchorPos.current.y); ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.strokeStyle = '#616161'; ctx.stroke();

        for (let i = particles.current.length - 1; i >= 0; i--) {
            const p = particles.current[i];
            if (p.type === 'ring') { p.size += 3; p.life -= 0.04; } else if (p.type === 'circle') { p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life -= 0.03; p.size *= 0.96; } else if (p.type === 'star') { p.x += p.vx; p.y += p.vy; p.life -= 0.04; }
            if (p.life <= 0) particles.current.splice(i, 1);
            else { ctx.save(); ctx.globalAlpha = p.life;
                if (p.type === 'ring') { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.strokeStyle = p.color; ctx.lineWidth = 3 * p.life; ctx.stroke(); } 
                else if (p.type === 'circle') { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); } 
                else if (p.type === 'star') { ctx.translate(p.x, p.y); const rot = performance.now() / 150 + (i * 10); ctx.rotate(rot); ctx.fillStyle = p.color; ctx.beginPath(); const s = p.size * p.life; ctx.moveTo(0, -s); ctx.lineTo(s*0.3, -s*0.3); ctx.lineTo(s, 0); ctx.lineTo(s*0.3, s*0.3); ctx.lineTo(0, s); ctx.lineTo(-s*0.3, s*0.3); ctx.lineTo(-s, 0); ctx.lineTo(-s*0.3, -s*0.3); ctx.fill(); }
                ctx.restore();
            }
        }
        ctx.restore();

        if (captureRequestRef.current) {
            captureRequestRef.current = false;
            const offscreen = document.createElement('canvas'); const targetWidth = 480; const scale = Math.min(1, targetWidth / logicalWidth.current);
            offscreen.width = logicalWidth.current * scale; offscreen.height = logicalHeight.current * scale;
            const oCtx = offscreen.getContext('2d');
            if (oCtx) { oCtx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height); const screenshot = offscreen.toDataURL("image/jpeg", 0.5); setTimeout(() => performAiAnalysis(screenshot), 0); }
        }
      }
    };

    if (window.Hands) {
      hands = new window.Hands({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`, });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.8, minTrackingConfidence: 0.7, });
      hands.onResults(onResults);
      
      const loop = async () => {
          if (videoRef.current && videoRef.current.readyState >= 2 && appState !== 'BOOT') {
              try {
                  await hands.send({ image: videoRef.current });
              } catch (e) {
                  // Ignore frame errors
              }
          }
          requestRef.current = requestAnimationFrame(loop);
      };
      
      loop();
    }

    return () => { 
        if (hands) hands.close(); 
        cancelAnimationFrame(requestRef.current);
    };
  }, [appState]);

  const recColorConfig = aiRecommendedColor ? COLOR_CONFIG[aiRecommendedColor] : null;
  const borderColor = recColorConfig ? recColorConfig.hex : '#444746';
  const diffSettings = DIFFICULTIES[difficulty];

  // --- RENDER ---
  return (
    <div className="flex w-full h-screen bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3]">
      
      {/* SECURITY OVERLAY (For Boot / Hand Scan / Voice) */}
      {(appState === 'BOOT' || appState === 'HAND_SCAN' || appState === 'VOICE_VERIFY') && (
          <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
              <div className="bg-[#1e1e1e]/90 p-10 rounded-3xl border border-green-500/50 shadow-[0_0_50px_rgba(0,255,100,0.2)] text-center max-w-lg w-full relative overflow-hidden">
                  
                  {/* Decorative Scan Lines */}
                  <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(0deg,transparent,rgba(0,255,100,0.2),transparent)] bg-[length:100%_4px] animate-scan"></div>
                  
                  {permissionError ? (
                       <div className="flex flex-col items-center animate-fade-in">
                            <AlertTriangle className="w-16 h-16 text-yellow-500 mb-6" />
                            <h2 className="text-2xl font-bold mb-4 tracking-wider uppercase text-white">Access Protocol Failure</h2>
                            <p className="mb-8 text-gray-300 font-mono text-sm max-w-md text-center leading-relaxed">
                                {permissionError.message}
                            </p>
                            <button 
                                onClick={() => permissionError.type === 'camera' ? handleSystemStart() : startRecording()}
                                className="px-8 py-3 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-lg transition-all shadow-[0_0_20px_rgba(202,138,4,0.3)] uppercase tracking-wider flex items-center gap-2"
                            >
                                <RefreshCw className="w-5 h-5" />
                                Retry Authorization
                            </button>
                            <p className="mt-6 text-xs text-gray-500 uppercase tracking-widest font-bold">Error: {permissionError.type.toUpperCase()}_BLOCKED</p>
                       </div>
                  ) : appState === 'BOOT' ? (
                       <div className="flex flex-col items-center">
                            <ShieldCheck className="w-16 h-16 text-blue-500 mb-6" />
                            <h1 className="text-3xl font-bold mb-4 tracking-widest uppercase text-white">Gemini Slingshot</h1>
                            <p className="mb-8 text-gray-400 font-mono text-sm max-w-md text-center">
                                Secure biometric authentication required to access weapon systems. 
                                Please enable camera and microphone access for verification.
                            </p>
                            <button 
                                onClick={handleSystemStart}
                                disabled={loading}
                                className={`px-8 py-3 font-bold rounded-lg transition-all shadow-[0_0_20px_rgba(37,99,235,0.5)] uppercase tracking-wider flex items-center gap-2 ${loading ? 'bg-gray-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Monitor className="w-5 h-5" />}
                                {loading ? "Initializing..." : "Initialize System"}
                            </button>
                       </div>
                  ) : (
                    <>
                        <div className="mb-6 flex justify-center">
                            <div className="w-24 h-24 rounded-full bg-black/50 flex items-center justify-center border-2 border-green-500 relative">
                                {appState === 'HAND_SCAN' ? (
                                    <ScanFace className="w-12 h-12 text-green-400 animate-pulse" />
                                ) : (
                                    <Mic className="w-12 h-12 text-blue-400 animate-pulse" />
                                )}
                                <div className="absolute inset-0 rounded-full border-t-2 border-green-400 animate-spin"></div>
                            </div>
                        </div>

                        <h2 className="text-2xl font-bold text-white mb-2 tracking-widest uppercase font-mono">
                            {appState === 'HAND_SCAN' ? "Biometric Scan" : "Voice Authentication"}
                        </h2>
                        <p className="text-green-400 font-mono text-sm mb-6 animate-pulse">{statusMessage}</p>

                        {appState === 'HAND_SCAN' && (
                            <div className="w-full bg-gray-800 rounded-full h-2 mb-4">
                                <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${scanProgress}%` }}></div>
                            </div>
                        )}

                        {appState === 'VOICE_VERIFY' && (
                            <div className="space-y-4">
                                <p className="text-gray-400 text-sm italic">"My name is Rafay and I approved"</p>
                                <button 
                                    onClick={startRecording}
                                    disabled={isRecording}
                                    className={`w-full py-4 font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${isRecording ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                                >
                                    {isRecording ? <div className="flex gap-2"><div className="w-2 h-2 bg-red-500 rounded-full animate-bounce"/> Recording...</div> : <><Mic className="w-5 h-5"/> {localStorage.getItem('GEMINI_OWNER_PROFILE') ? "Verify Voice" : "Register Voice"}</>}
                                </button>
                            </div>
                        )}
                    </>
                  )}
                  
                  <div className="mt-6 flex justify-between text-[10px] text-gray-500 uppercase font-mono tracking-widest">
                      <span>SEC-LEVEL: 5 (MAX)</span>
                      <span>ENCRYPTION: AES-256</span>
                  </div>
              </div>
          </div>
      )}

      {/* GAME OVER OVERLAY */}
      {gameOver && (
          <div className="absolute inset-0 z-[110] bg-black/80 flex items-center justify-center backdrop-blur-sm">
              <div className="bg-[#1e1e1e] p-8 rounded-3xl border border-[#ef5350] shadow-2xl text-center max-w-md w-full mx-4">
                  <div className="w-20 h-20 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                      <ShieldAlert className="w-10 h-10 text-[#ef5350]" />
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-2">Game Over</h2>
                  <p className="text-gray-400 mb-6">The bubbles reached the danger zone!</p>
                  
                  <div className="bg-[#121212] rounded-xl p-4 mb-8">
                      <p className="text-xs text-gray-500 uppercase font-bold tracking-widest mb-1">Final Score</p>
                      <p className="text-4xl font-mono text-[#a8c7fa]">{score.toLocaleString()}</p>
                  </div>
                  
                  <button onClick={restartGame} className="w-full py-4 bg-[#a8c7fa] hover:bg-[#82b1ff] text-[#000] font-bold rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2">
                      <RotateCcw className="w-5 h-5" /> Try Again
                  </button>
              </div>
          </div>
      )}

      {/* MAIN GAME CONTAINER */}
      <div ref={gameContainerRef} className="flex-1 relative h-full overflow-hidden">
        <video 
            ref={videoRef} 
            className="absolute opacity-0 pointer-events-none" 
            playsInline 
            autoPlay 
            muted 
        />
        <canvas 
            ref={canvasRef} 
            className="absolute inset-0 touch-none" 
            onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
            onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={(e) => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchEnd={handleEnd}
        />

        {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
            <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-[#42a5f5] animate-spin mb-4" />
                <p className="text-[#e3e3e3] text-lg font-medium">Calibrating AR Optics...</p>
            </div>
            </div>
        )}

        {/* HUD Elements - Only show during gameplay */}
        {appState === 'PLAYING' && (
            <>
                <div className="absolute top-6 right-6 z-40 flex bg-[#1e1e1e] p-1 rounded-full border border-[#444746] shadow-lg">
                    {(['Easy', 'Medium', 'Hard'] as DifficultyLevel[]).map(lvl => (
                        <button key={lvl} onClick={() => handleDifficultyChange(lvl)} className={`px-4 py-2 rounded-full text-xs font-bold uppercase transition-all ${difficulty === lvl ? 'bg-[#444746] text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>
                            {lvl}
                        </button>
                    ))}
                </div>

                <div className="absolute top-24 right-6 z-30 w-32">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">Ceiling Drop</span>
                        <span className="text-[10px] font-mono text-gray-400">{shotsUntilDrop} left</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#1e1e1e] rounded-full overflow-hidden border border-[#444746]">
                        <div className="h-full transition-all duration-300 ease-out" style={{ width: `${(shotsUntilDrop / diffSettings.dropInterval) * 100}%`, backgroundColor: shotsUntilDrop <= 2 ? '#ef5350' : '#a8c7fa' }} />
                    </div>
                </div>

                <div className="absolute top-6 left-6 z-40 pointer-events-none">
                    <div className="bg-[#1e1e1e] p-5 rounded-[28px] border border-[#444746] shadow-2xl flex items-center gap-4 min-w-[180px]">
                        <div className="bg-[#42a5f5]/20 p-3 rounded-full">
                            <Trophy className="w-6 h-6 text-[#42a5f5]" />
                        </div>
                        <div>
                            <p className="text-xs text-[#c4c7c5] uppercase tracking-wider font-medium">Score</p>
                            <p className="text-3xl font-bold text-white">{score.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
                    <div className="bg-[#1e1e1e] px-6 py-4 rounded-[32px] border border-[#444746] shadow-2xl flex items-center gap-4">
                        <p className="text-xs text-[#c4c7c5] uppercase font-bold tracking-wider mr-2 hidden md:block">Select Color</p>
                        {availableColors.length === 0 ? <p className="text-sm text-gray-500">No ammo</p> : 
                            COLOR_KEYS.filter(c => availableColors.includes(c)).map(color => {
                                const isSelected = selectedColor === color;
                                const isRecommended = aiRecommendedColor === color;
                                const config = COLOR_CONFIG[color];
                                return (
                                    <button key={color} onClick={() => setSelectedColor(color)} className={`relative w-14 h-14 rounded-full transition-all duration-300 transform flex items-center justify-center ${isSelected ? 'scale-110 ring-4 ring-white/50 z-10' : 'opacity-80 hover:opacity-100 hover:scale-105'}`} style={{ background: `radial-gradient(circle at 35% 35%, ${config.hex}, ${adjustColor(config.hex, -60)})`, boxShadow: isSelected ? `0 0 20px ${config.hex}, inset 0 -4px 4px rgba(0,0,0,0.3)` : '0 4px 6px rgba(0,0,0,0.3), inset 0 -4px 4px rgba(0,0,0,0.3)' }}>
                                        <div className="absolute top-2 left-3 w-4 h-2 bg-white/40 rounded-full transform -rotate-45 filter blur-[1px]" />
                                        {isRecommended && !isSelected && <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-black text-[10px] font-bold flex items-center justify-center rounded-full animate-bounce shadow-md">!</span>}
                                        {isSelected && <MousePointerClick className="w-6 h-6 text-white/90 drop-shadow-md" />}
                                    </button>
                                )
                            })
                        }
                    </div>
                </div>
            </>
        )}
      </div>

      <div className="w-[380px] bg-[#1e1e1e] border-l border-[#444746] flex flex-col h-full overflow-hidden shadow-2xl relative">
        {appState === 'PLAYING' ? (
            <>
                <div className="p-5 border-b-4 transition-colors duration-500 flex flex-col gap-2" style={{ backgroundColor: '#252525', borderColor: borderColor }}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BrainCircuit className="w-5 h-5" style={{ color: borderColor }} />
                            <h2 className="font-bold text-sm tracking-widest uppercase" style={{ color: borderColor }}>Flash Strategy</h2>
                        </div>
                        {isAiThinking && <Loader2 className="w-4 h-4 animate-spin text-white/50" />}
                    </div>
                    <p className="text-[#e3e3e3] text-sm leading-relaxed font-bold">{aiHint}</p>
                    {aiRationale && <div className="flex gap-2 mt-1"><Lightbulb className="w-4 h-4 text-[#a8c7fa] shrink-0 mt-0.5" /><p className="text-[#a8c7fa] text-xs italic opacity-90 leading-tight">{aiRationale}</p></div>}
                    {aiRecommendedColor && <div className="flex items-center gap-2 mt-3 bg-black/20 p-2 rounded"><Target className="w-4 h-4 text-gray-400" /><span className="text-xs text-gray-400 uppercase tracking-wide">Rec. Color:</span><span className="text-xs font-bold uppercase" style={{ color: COLOR_CONFIG[aiRecommendedColor].hex }}>{COLOR_CONFIG[aiRecommendedColor].label}</span></div>}
                </div>
                <div className="p-4 border-b border-[#444746] bg-[#1e1e1e]">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[#757575]"><Flame className="w-4 h-4" /><span className="text-[10px] font-bold uppercase tracking-wider">Difficulty Settings</span></div>
                        <span className="text-[10px] font-bold uppercase" style={{ color: diffSettings.color }}>{difficulty}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                        <div className="bg-[#121212] p-2 rounded border border-[#333]"><span className="block text-[9px] uppercase text-gray-600 mb-0.5">Drop Speed</span>Every {diffSettings.dropInterval} shots</div>
                        <div className="bg-[#121212] p-2 rounded border border-[#333]"><span className="block text-[9px] uppercase text-gray-600 mb-0.5">Aim Guide</span>{Math.round(diffSettings.guideLength / 60 * 100)}% Length</div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-[#333] grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-black border border-gray-500 relative"><div className="absolute top-0 right-0 w-1 h-1 bg-red-500 rounded-full animate-pulse"></div></div><span className="text-[10px] uppercase text-gray-400 font-bold">Bomb</span></div>
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500"></div><span className="text-[10px] uppercase text-gray-400 font-bold">Rainbow</span></div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    <div>
                        <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider"><BrainCircuit className="w-3 h-3" /> Status</div>
                        <div className={`p-3 rounded-lg border ${isAiThinking ? 'bg-[#a8c7fa]/10 border-[#a8c7fa]/30 text-[#a8c7fa]' : 'bg-[#444746]/20 border-[#444746]/50 text-[#c4c7c5]'}`}>
                            <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${isAiThinking ? 'bg-[#a8c7fa] animate-pulse' : 'bg-[#66bb6a]'}`} /><span className="text-sm font-mono">{isAiThinking ? 'Processing Vision...' : 'Waiting for Input'}</span></div>
                        </div>
                    </div>
                    {debugInfo?.error && <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-xs"><div className="flex items-center gap-2 mb-1 font-bold"><Target className="w-3 h-3" /> Error</div>{debugInfo.error}</div>}
                </div>
            </>
        ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center opacity-50">
                <ShieldCheck className="w-16 h-16 text-gray-600 mb-4" />
                <h3 className="text-gray-400 font-bold uppercase tracking-widest">System Locked</h3>
                <p className="text-xs text-gray-600 mt-2 font-mono">Authentication Pending...</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default GeminiSlingshot;
