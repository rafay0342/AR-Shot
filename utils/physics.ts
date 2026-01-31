/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point } from "../types";

/**
 * Advanced Hand Physics Engine
 * Implements Holt's Linear Trend method for smoothing and inertia.
 */
export class HandStabilizer {
  private lastPos: Point | null = null;
  private trend: Point = { x: 0, y: 0 };
  private velocity: Point = { x: 0, y: 0 };
  
  // Tuning Parameters
  private alpha = 0.4; // Smoothing factor (position)
  private beta = 0.2;  // Smoothing factor (trend/velocity)
  private drag = 0.85; // Friction for inertia when tracking is lost/paused

  // Intent Detection Config
  private static VELOCITY_THRESHOLD = 50; // Pixels per frame
  private static EDGE_MARGIN = 0.05; // 5% margin

  reset() {
    this.lastPos = null;
    this.trend = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
  }

  /**
   * Updates the physics model with a new raw observation.
   * Returns the smoothed, physics-based position.
   */
  update(rawPos: Point | null, width: number, height: number): Point | null {
    if (!rawPos) {
      // Inertia Mode: Continue movement slightly if hand is lost momentarily
      if (this.lastPos && (Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.y) > 0.1)) {
        this.lastPos.x += this.velocity.x;
        this.lastPos.y += this.velocity.y;
        this.velocity.x *= this.drag;
        this.velocity.y *= this.drag;
        return { ...this.lastPos };
      }
      return null;
    }

    if (!this.lastPos) {
      this.lastPos = rawPos;
      return rawPos;
    }

    // Double Exponential Smoothing
    const prevPos = this.lastPos;
    const prevTrend = this.trend;

    // Calculate Level (Smoothed Position)
    const newX = this.alpha * rawPos.x + (1 - this.alpha) * (prevPos.x + prevTrend.x);
    const newY = this.alpha * rawPos.y + (1 - this.alpha) * (prevPos.y + prevTrend.y);

    // Calculate Trend (Smoothed Velocity)
    const newTrendX = this.beta * (newX - prevPos.x) + (1 - this.beta) * prevTrend.x;
    const newTrendY = this.beta * (newY - prevPos.y) + (1 - this.beta) * prevTrend.y;

    this.lastPos = { x: newX, y: newY };
    this.trend = { x: newTrendX, y: newTrendY };
    this.velocity = { x: newTrendX, y: newTrendY }; // Store for inertia

    return this.lastPos;
  }

  /**
   * Determines if the hand movement is intentional for gameplay
   * or casual (drinking water, scratching nose, etc).
   */
  isIntentional(landmarks: any[], width: number, height: number): boolean {
    if (!landmarks || landmarks.length === 0) return false;

    // 1. Screen Edge Check (Hands entering/leaving are often unintentional)
    const wrist = landmarks[0];
    if (
      wrist.x < HandStabilizer.EDGE_MARGIN || 
      wrist.x > 1 - HandStabilizer.EDGE_MARGIN || 
      wrist.y > 1 - HandStabilizer.EDGE_MARGIN
    ) {
      return false;
    }

    // 2. Velocity Check (Too fast = casual gesture or glitch)
    const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
    if (speed > HandStabilizer.VELOCITY_THRESHOLD) {
      return false;
    }

    // 3. Palm Orientation Check (Rough approximation via landmark z-depth)
    // If Pinky MCP (17) is significantly deeper than Index MCP (5), hand might be sideways
    const indexMCP = landmarks[5];
    const pinkyMCP = landmarks[17];
    if (Math.abs(indexMCP.z - pinkyMCP.z) > 0.15) {
       // Hand is likely rotated sideways (not facing screen)
       return false;
    }

    return true;
  }
}