import { Repository } from 'typeorm';
import { AppDataSource } from '../../config/ormconfig';
import { DraftAssignment } from '../../entities/DraftAssignment';
import { DraftGroup } from '../../entities/DraftGroup';
import { Order } from '../../entities/Order';
import { Driver } from '../../entities/Driver';
import { clarkeWrightSolver } from './clarkeWrightSolver';
import { alnsSolver } from './alnsSolver';
import { v4 as uuidv4 } from 'uuid';

/**
 * Draft Service - Main orchestrator for draft assignment system
 *
 * Generates multiple draft groups, validates constraints, and selects best solution
 */
export class DraftService {
  private draftRepo: Repository<DraftAssignment>;
  private groupRepo: Repository<DraftGroup>;

  constructor() {
    this.draftRepo = AppDataSource.getRepository(DraftAssignment);
    this.groupRepo = AppDataSource.getRepository(DraftGroup);
  }

  /**
   * Main entry point: Generate multiple draft groups and select best
   */
  async generateDraftGroups(
    orders: Order[],
    drivers: Driver[],
    numGroups: number = 3
  ): Promise<DraftGroup> {
    const sessionId = uuidv4();
    const groups: DraftGroup[] = [];

    console.log(
      `Starting draft generation: ${orders.length} orders, ${drivers.length} drivers, ${numGroups} groups`
    );

    // Generate multiple draft groups with different strategies
    for (let i = 0; i < numGroups; i++) {
      let group: DraftGroup;

      try {
        switch (i % 3) {
          case 0:
            // Pure Clarke-Wright
            console.log(`Group ${i + 1}: Pure Clarke-Wright`);
            group = await clarkeWrightSolver.solve(orders, drivers, sessionId);
            break;

          case 1:
            // Clarke-Wright + ALNS (2s)
            console.log(`Group ${i + 1}: Clarke-Wright + ALNS (2s)`);
            const cwSolution = await clarkeWrightSolver.solve(
              orders,
              drivers,
              sessionId
            );
            group = await alnsSolver.improve(
              cwSolution,
              orders,
              drivers,
              sessionId,
              2000
            );
            break;

          case 2:
            // Clarke-Wright + ALNS (5s) - more thorough
            console.log(`Group ${i + 1}: Clarke-Wright + ALNS (5s)`);
            const cwSolution2 = await clarkeWrightSolver.solve(
              orders,
              drivers,
              sessionId
            );
            group = await alnsSolver.improve(
              cwSolution2,
              orders,
              drivers,
              sessionId,
              5000
            );
            break;

          default:
            group = await clarkeWrightSolver.solve(orders, drivers, sessionId);
        }

        // Algorithms now populate assignments - no need to recreate them
        // Validate VRPPD constraints
        const isValid = await this.validateDraftGroup(group);
        if (!isValid) {
          console.warn(`Draft group ${i + 1} failed VRPPD validation`);
          group.metadata.constraintsViolated.push('VRPPD');
        }

        // Save draft group with assignments to database
        const savedGroup = await this.groupRepo.save(group);
        groups.push(savedGroup);

        console.log(
          `Group ${i + 1} complete: ${savedGroup.totalTravelTime.toFixed(2)} min, ${savedGroup.ordersCount} orders`
        );
      } catch (error) {
        console.error(`Failed to generate draft group ${i + 1}:`, error);
        continue;
      }
    }

    if (groups.length === 0) {
      throw new Error('Failed to generate any valid draft groups');
    }

    // Select best group (minimum total travel time)
    const bestGroup = groups.reduce((best, current) =>
      current.totalTravelTime < best.totalTravelTime ? current : best
    );

    bestGroup.isSelected = true;
    await this.groupRepo.save(bestGroup);

    console.log(
      `Selected best group: ${bestGroup.id} with ${bestGroup.totalTravelTime.toFixed(2)} min total time`
    );

    // Load with assignments for return
    const result = await this.groupRepo.findOne({
      where: { id: bestGroup.id },
      relations: ['assignments', 'assignments.driver', 'assignments.order'],
    });

    return result!;
  }

  /**
   * Validate VRPPD constraint: pickup before delivery
   */
  async validateDraftGroup(draftGroup: DraftGroup): Promise<boolean> {
    const assignments = draftGroup.assignments || [];

    // Group by driver
    const driverRoutes = new Map<string, DraftAssignment[]>();

    for (const assignment of assignments) {
      if (!driverRoutes.has(assignment.driverId)) {
        driverRoutes.set(assignment.driverId, []);
      }
      driverRoutes.get(assignment.driverId)!.push(assignment);
    }

    // Validate each driver's route
    for (const [driverId, route] of driverRoutes) {
      // Sort by sequence
      route.sort((a, b) => a.sequence - b.sequence);

      // Validate VRPPD: pickup time < delivery time for each order
      for (const assignment of route) {
        if (
          assignment.estimatedPickupTime >= assignment.estimatedDeliveryTime
        ) {
          console.error(
            `VRPPD violation: Driver ${driverId}, Order ${assignment.orderId} - pickup at ${assignment.estimatedPickupTime} >= delivery at ${assignment.estimatedDeliveryTime}`
          );
          return false;
        }
      }

      // Validate time sequence: each stop happens after previous stop
      for (let i = 1; i < route.length; i++) {
        const prev = route[i - 1];
        const curr = route[i];

        if (curr.estimatedPickupTime <= prev.estimatedDeliveryTime) {
          console.error(
            `Time sequence violation: Driver ${driverId} - Order ${curr.orderId} pickup (${curr.estimatedPickupTime}) before previous delivery (${prev.estimatedDeliveryTime})`
          );
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get draft group with assignments
   */
  async getDraftGroup(groupId: number): Promise<DraftGroup | null> {
    return await this.groupRepo.findOne({
      where: { id: groupId },
      relations: ['assignments', 'assignments.driver', 'assignments.order'],
    });
  }

  /**
   * Get all draft groups for a session
   */
  async getSessionDraftGroups(sessionId: string): Promise<DraftGroup[]> {
    return await this.groupRepo.find({
      where: { sessionId },
      relations: ['assignments'],
      order: { totalTravelTime: 'ASC' },
    });
  }

  /**
   * Get the selected (best) draft group for a session
   */
  async getSelectedDraftGroup(sessionId: string): Promise<DraftGroup | null> {
    return await this.groupRepo.findOne({
      where: { sessionId, isSelected: true },
      relations: ['assignments', 'assignments.driver', 'assignments.order'],
    });
  }

  /**
   * Clean up old draft groups (older than N days)
   */
  async cleanupOldDrafts(daysOld: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.groupRepo
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }

  /**
   * Get draft statistics
   */
  async getDraftStatistics(): Promise<{
    totalGroups: number;
    avgComputationTime: number;
    avgQualityScore: number;
    avgTravelTime: number;
    recentGroups: DraftGroup[];
  }> {
    const groups = await this.groupRepo.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      totalGroups: groups.length,
      avgComputationTime:
        groups.reduce((sum, g) => sum + g.metadata.computationTimeMs, 0) /
          groups.length || 0,
      avgQualityScore:
        groups.reduce((sum, g) => sum + g.metadata.qualityScore, 0) /
          groups.length || 0,
      avgTravelTime:
        groups.reduce((sum, g) => sum + g.totalTravelTime, 0) /
          groups.length || 0,
      recentGroups: groups.slice(0, 10),
    };
  }
}

// Export singleton instance
export const draftService = new DraftService();
