/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Point {
  x: number;
  y: number;
}

export interface Vector {
  vx: number;
  vy: number;
}

export type BubbleColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export interface Bubble {
  id: string;
  row: number;
  col: number;
  x: number;
  y: number;
  color: BubbleColor;
  active: boolean; // if false, popped
  isFloating?: boolean; // For animation
  powerUp?: 'bomb' | 'rainbow';
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
  type: 'circle' | 'ring' | 'star';
}

export interface StrategicHint {
  message: string;
  rationale?: string;
  targetRow?: number;
  targetCol?: number;
  recommendedColor?: BubbleColor;
}

export interface DebugInfo {
  latency: number;
  screenshotBase64?: string;
  promptContext: string;
  rawResponse: string;
  parsedResponse?: any;
  error?: string;
  timestamp: string;
}

export interface TargetCandidate {
  id: string;
  color: string;
  size: number;
  row: number;
  col: number;
  pointsPerBubble: number;
  description: string;
  powerUp?: 'bomb' | 'rainbow';
}

export interface AiResponse {
  hint: StrategicHint;
  debug: DebugInfo;
}

// --- NEW SECURITY TYPES ---

export type UserRole = 'OWNER' | 'ADMIN' | 'USER' | 'GUEST' | 'UNVERIFIED';

export interface HandGeometry {
  id: string; // Hash of geometry
  ratios: number[]; // Finger length to palm width ratios
  confidence: number;
}

export interface VoicePrint {
  signature: number[]; // Frequency data
  phrase: string;
}

export interface UserProfile {
  id: string;
  role: UserRole;
  name: string;
  handGeometry: HandGeometry;
  voicePrint?: VoicePrint;
  createdAt: number;
}

// MediaPipe Type Definitions (Augmenting window)
declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}

// --- LEGACY CITY BUILDER TYPES ---

export enum BuildingType {
  None = 'none',
  Road = 'road',
  Residential = 'residential',
  Commercial = 'commercial',
  Industrial = 'industrial',
  Park = 'park',
}

export interface BuildingConfig {
  type: BuildingType;
  cost: number;
  name: string;
  description: string;
  color: string;
  popGen: number;
  incomeGen: number;
}

export interface TileData {
  x: number;
  y: number;
  buildingType: BuildingType;
}

export type Grid = TileData[][];

export interface CityStats {
  money: number;
  population: number;
  day: number;
}

export interface AIGoal {
  description: string;
  targetType: 'building_count' | 'money' | 'population';
  targetValue: number;
  buildingType?: BuildingType;
  reward: number;
  completed: boolean;
}

export interface NewsItem {
  id: string;
  text: string;
  type: 'positive' | 'negative' | 'neutral';
}