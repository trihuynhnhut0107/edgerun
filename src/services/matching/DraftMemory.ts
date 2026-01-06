/**
 * DRAFT MEMORY
 *
 * In-memory storage for temporary route calculations during Draft phase.
 * Enables efficient scoring and comparison of multiple assignment options
 * before persisting offers to database.
 *
 * Lifecycle:
 * 1. Draft Phase: Calculate and store candidate routes
 * 2. Score Phase: Evaluate drafts (distance, time windows, priority)
 * 3. Select Phase: Choose best assignments
 * 4. Clear Phase: Reset for next iteration
 */

import { DraftResult } from "./matchingEngine";

/**
 * Extended draft with scoring metadata
 */
export interface ScoredDraft extends DraftResult {
  totalScore: number; // Combined score (lower is better)
  distanceScore: number; // Insertion cost normalized
  priorityScore: number; // Order priority (already in DraftResult)
  timeWindowScore: number; // Time window violation risk
  confidence: number; // Confidence in this assignment (0-1)
}

/**
 * DraftMemory: Temporary storage for route candidates
 */
export class DraftMemory {
  private drafts: Map<string, ScoredDraft[]>; // driverId -> candidate drafts
  private selectedDrafts: ScoredDraft[]; // Final selections

  constructor() {
    this.drafts = new Map();
    this.selectedDrafts = [];
  }

  /**
   * Add a draft assignment for a driver
   * Multiple drafts can exist per driver (competing orders)
   */
  addDraft(driverId: string, draft: DraftResult): void {
    if (!this.drafts.has(driverId)) {
      this.drafts.set(driverId, []);
    }

    // Calculate scores
    const scored = this.scoreDraft(draft);
    this.drafts.get(driverId)!.push(scored);
  }

  /**
   * Score a draft based on multiple criteria
   *
   * Scoring components:
   * 1. Distance Score: Lower insertion cost is better
   * 2. Priority Score: Higher order priority is better
   * 3. Time Window Score: Lower violation risk is better
   * 4. Confidence: Overall assignment confidence
   *
   * Total Score = weighted sum (lower is better)
   */
  private scoreDraft(draft: DraftResult): ScoredDraft {
    // Normalize distance score (0-1, where 0 is best)
    // Assume max reasonable insertion cost is 50km
    const distanceScore = Math.min(draft.insertionCost / 50000, 1.0);

    // Normalize priority score (0-1, where 0 is best, inverted from priorityScore)
    // Assume max priority score is 100
    const priorityScore = Math.max(0, 1 - draft.priorityScore / 100);

    // Time window score (placeholder - will be enhanced with SAA validation)
    // For now, use a simple estimate based on time difference
    const timeWindowScore = this.estimateTimeWindowViolationRisk(draft);

    // Calculate confidence (0-1, where 1 is highest confidence)
    const confidence = this.calculateConfidence(
      distanceScore,
      priorityScore,
      timeWindowScore
    );

    // Weighted total score (lower is better)
    // Weights: distance (40%), priority (30%), time window (30%)
    const totalScore =
      distanceScore * 0.4 + priorityScore * 0.3 + timeWindowScore * 0.3;

    return {
      ...draft,
      totalScore,
      distanceScore,
      timeWindowScore,
      confidence,
    };
  }

  /**
   * Estimate time window violation risk (0-1, where 0 is best)
   * This is a placeholder - will be enhanced with actual SAA calculations
   */
  private estimateTimeWindowViolationRisk(draft: DraftResult): number {
    // For now, use a simple heuristic based on time difference
    const pickupTime = draft.estimatedPickup.getTime();
    const deliveryTime = draft.estimatedDelivery.getTime();
    const diffMinutes = (deliveryTime - pickupTime) / (1000 * 60);

    // Ideal delivery time: 15-30 minutes
    // Longer or shorter is riskier
    if (diffMinutes < 15) {
      return (15 - diffMinutes) / 15; // Too short: risk 0-1
    } else if (diffMinutes > 30) {
      return Math.min((diffMinutes - 30) / 30, 1.0); // Too long: risk 0-1
    } else {
      return 0; // Ideal range: no risk
    }
  }

  /**
   * Calculate overall confidence in assignment (0-1)
   */
  private calculateConfidence(
    distanceScore: number,
    priorityScore: number,
    timeWindowScore: number
  ): number {
    // Average of inverse scores (higher scores = lower confidence)
    const avgScore = (distanceScore + priorityScore + timeWindowScore) / 3;
    return 1 - avgScore;
  }

  /**
   * Get best-scored draft for a specific driver
   */
  getBestDraftForDriver(driverId: string): ScoredDraft | null {
    const driverDrafts = this.drafts.get(driverId);
    if (!driverDrafts || driverDrafts.length === 0) {
      return null;
    }

    // Sort by total score (ascending - lower is better)
    return driverDrafts.sort((a, b) => a.totalScore - b.totalScore)[0];
  }

  /**
   * Get all drafts for a driver (sorted by score)
   */
  getDraftsForDriver(driverId: string): ScoredDraft[] {
    const driverDrafts = this.drafts.get(driverId) || [];
    return driverDrafts.sort((a, b) => a.totalScore - b.totalScore);
  }

  /**
   * Select best drafts across all drivers
   * Resolves conflicts (same order assigned to multiple drivers)
   * Allows multiple orders per driver (up to capacity)
   *
   * Algorithm:
   * 1. Collect all drafts from all drivers
   * 2. Sort by total score (ascending - best first)
   * 3. Greedly select best assignments
   * 4. Skip conflicts (order already assigned)
   * 5. Respect driver capacity (maxOrders per driver)
   */
  selectBestDrafts(driverCapacities?: Map<string, number>): ScoredDraft[] {
    const allDrafts: ScoredDraft[] = [];

    // Collect all drafts
    for (const driverDrafts of this.drafts.values()) {
      allDrafts.push(...driverDrafts);
    }

    // Sort by total score (ascending - best first)
    allDrafts.sort((a, b) => a.totalScore - b.totalScore);

    // Greedy selection (no order conflicts, respect driver capacity)
    const selected: ScoredDraft[] = [];
    const assignedOrders = new Set<string>();
    const driverOrderCounts = new Map<string, number>();

    for (const draft of allDrafts) {
      // Skip if order already assigned
      if (assignedOrders.has(draft.orderId)) {
        continue;
      }

      // Check driver capacity
      const currentCount = driverOrderCounts.get(draft.driverId) || 0;
      const maxOrders = driverCapacities?.get(draft.driverId) || Infinity;

      if (currentCount >= maxOrders) {
        // Driver at capacity, skip this assignment
        continue;
      }

      // Accept this assignment
      selected.push(draft);
      assignedOrders.add(draft.orderId);
      driverOrderCounts.set(draft.driverId, currentCount + 1);
    }

    this.selectedDrafts = selected;
    return selected;
  }

  /**
   * Get selected drafts (after selectBestDrafts called)
   */
  getSelectedDrafts(): ScoredDraft[] {
    return this.selectedDrafts;
  }

  /**
   * Get statistics about current drafts
   */
  getStats(): {
    totalDrafts: number;
    driverCount: number;
    avgDraftsPerDriver: number;
    avgScore: number;
    avgConfidence: number;
  } {
    let totalDrafts = 0;
    let totalScore = 0;
    let totalConfidence = 0;

    for (const driverDrafts of this.drafts.values()) {
      totalDrafts += driverDrafts.length;
      for (const draft of driverDrafts) {
        totalScore += draft.totalScore;
        totalConfidence += draft.confidence;
      }
    }

    const driverCount = this.drafts.size;
    const avgDraftsPerDriver = driverCount > 0 ? totalDrafts / driverCount : 0;
    const avgScore = totalDrafts > 0 ? totalScore / totalDrafts : 0;
    const avgConfidence = totalDrafts > 0 ? totalConfidence / totalDrafts : 0;

    return {
      totalDrafts,
      driverCount,
      avgDraftsPerDriver,
      avgScore,
      avgConfidence,
    };
  }

  /**
   * Clear all drafts and reset memory
   */
  clear(): void {
    this.drafts.clear();
    this.selectedDrafts = [];
  }

  /**
   * Get draft count for a specific driver
   */
  getDraftCountForDriver(driverId: string): number {
    return this.drafts.get(driverId)?.length || 0;
  }

  /**
   * Remove drafts for a specific order (e.g., if order cancelled)
   */
  removeDraftsForOrder(orderId: string): void {
    for (const [driverId, driverDrafts] of this.drafts.entries()) {
      const filtered = driverDrafts.filter((d) => d.orderId !== orderId);
      this.drafts.set(driverId, filtered);
    }
  }

  /**
   * Get all unique order IDs in drafts
   */
  getOrderIds(): Set<string> {
    const orderIds = new Set<string>();
    for (const driverDrafts of this.drafts.values()) {
      for (const draft of driverDrafts) {
        orderIds.add(draft.orderId);
      }
    }
    return orderIds;
  }

  /**
   * Get all unique driver IDs in drafts
   */
  getDriverIds(): Set<string> {
    return new Set(this.drafts.keys());
  }
}
