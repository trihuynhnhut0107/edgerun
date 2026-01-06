/**
 * Matching Controller
 * Exposes the divide-and-conquer matching engine via REST API
 *
 * The matching engine uses a three-stage divide-and-conquer algorithm:
 * 1. Territory Sectorization: Assigns orders to nearest drivers
 * 2. Driver Matching: Determines driver-order assignments
 * 3. Route Optimization: Generates optimal delivery routes
 */

import { Controller, Get, Post, Route, Response, Tags, Query } from 'tsoa';
import {
  matchOrders,
  draftBestAssignments,
  offerAssignments,
  processResponses,
  runMatchingCycle,
} from '../../services/matching/matchingEngine';
import { orderAssignmentService } from '../../services/assignment/order-assignment.service';

interface RouteInfo {
  driverId: string;
  driverName: string;
  orderCount: number;
  totalDistance: number;
  distancePerOrder: number;
}

interface MatchingResponse {
  success: boolean;
  message: string;
  routes: RouteInfo[];
  summary: {
    totalRoutes: number;
    totalOrders: number;
    totalAssigned: number;
    totalDistance: number;
    computationTimeMs: number;
    timestamp: string;
  };
}

@Route('matching')
@Tags('Matching Engine')
export class MatchingController extends Controller {
  /**
   * Execute the divide-and-conquer matching engine
   *
   * Triggers the three-stage matching algorithm to:
   * - Assign all pending orders to available drivers
   * - Optimize delivery routes for each driver
   * - Return detailed route information and metrics
   *
   * @param verbose Include detailed route waypoints in response (default: false)
   * @returns MatchingResponse with optimized routes and metrics
   */
  @Post('optimize')
  @Response<MatchingResponse>(200, 'Matching completed successfully')
  @Response<{ error: string }>(400, 'No pending orders or available drivers')
  @Response<{ error: string }>(500, 'Matching engine error')
  async optimizeMatching(
    @Query() verbose: boolean = false
  ): Promise<MatchingResponse> {
    console.log('📍 API: Optimize matching request received');
    const startTime = Date.now();

    const routes = await matchOrders();

    const totalDistance = routes.reduce((sum, r) => sum + r.totalDistance, 0);
    const totalOrders = routes.reduce((sum, r) => sum + r.metrics.orderCount, 0);
    const computationTimeMs = Date.now() - startTime;

    const responseMessage = `Matching completed: ${totalOrders} orders assigned across ${routes.length} routes${
      verbose ? ' with detailed waypoints' : ''
    }`;

    return {
      success: true,
      message: responseMessage,
      routes: routes.map((r) => ({
        driverId: r.driverId,
        driverName: r.driverName,
        orderCount: r.metrics.orderCount,
        totalDistance: r.totalDistance,
        distancePerOrder: r.metrics.distancePerOrder,
      })),
      summary: {
        totalRoutes: routes.length,
        totalOrders,
        totalAssigned: totalOrders,
        totalDistance,
        computationTimeMs,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * TESTING: Manual draft trigger
   * Runs Phase 1 (Draft) of the assignment lifecycle
   */
  @Post('draft')
  @Response<{ success: boolean; drafts: any[]; count: number }>(200, 'Draft completed')
  async triggerDraft(
    @Query() round: number = 1
  ): Promise<{ success: boolean; drafts: any[]; count: number }> {
    console.log(`🎯 Manual draft trigger - Round ${round}`);
    const drafts = await draftBestAssignments(round);

    return {
      success: true,
      drafts: drafts.map((d) => ({
        orderId: d.orderId,
        driverId: d.driverId,
        priorityScore: d.priorityScore,
        insertionCost: d.insertionCost,
      })),
      count: drafts.length,
    };
  }

  /**
   * TESTING: Manual offer trigger
   * Runs Phase 2 (Offer) - persists last draft as OFFERED assignments
   */
  @Post('offer')
  @Response<{ success: boolean; created: number }>(200, 'Offers created')
  async triggerOffer(
    @Query() round: number = 1
  ): Promise<{ success: boolean; created: number; message: string }> {
    console.log(`📤 Manual offer trigger - Round ${round}`);

    // Get latest drafts
    const drafts = await draftBestAssignments(round);
    const created = await offerAssignments(drafts, round);

    return {
      success: true,
      created,
      message: `${created} assignments offered to drivers`,
    };
  }

  /**
   * TESTING: Manual process trigger
   * Runs Phase 4 (Process) - expires stale offers and collects responses
   */
  @Post('process')
  @Response<{ success: boolean }>(200, 'Process completed')
  async triggerProcess(): Promise<{
    success: boolean;
    accepted: number;
    rejected: number;
    expired: number;
  }> {
    console.log(`📊 Manual process trigger`);
    const results = await processResponses();

    return {
      success: true,
      ...results,
    };
  }

  /**
   * TESTING: Manual expire stale offers
   * Expires all OFFERED assignments past their expiration time
   */
  @Post('expire-stale')
  @Response<{ success: boolean; expired: number }>(200, 'Stale offers expired')
  async expireStale(): Promise<{ success: boolean; expired: number }> {
    console.log(`⏱️  Manual expire stale trigger`);
    const expired = await orderAssignmentService.expireStaleOffers();

    return {
      success: true,
      expired,
    };
  }

  /**
   * TESTING: Run full matching cycle
   * Runs the complete draft→offer loop (pauses for manual testing)
   */
  @Post('cycle')
  @Response<{ success: boolean }>(200, 'Matching cycle started')
  async runCycle(): Promise<{ success: boolean; message: string }> {
    console.log(`🔄 Manual cycle trigger`);
    await runMatchingCycle();

    return {
      success: true,
      message: 'Matching cycle completed (paused for manual testing)',
    };
  }

  /**
   * Health check for matching service
   */
  @Get('health')
  @Response<{ status: string }>(200, 'Service is healthy')
  async healthCheck(): Promise<{ status: string }> {
    return { status: 'Matching service is healthy' };
  }
}
