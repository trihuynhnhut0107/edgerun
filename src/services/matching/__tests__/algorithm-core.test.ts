/**
 * Algorithm Core Tests
 *
 * Comprehensive tests for Clarke-Wright and ALNS algorithms
 * with controlled inputs and mocked distance calculations.
 *
 * Features:
 * - Deterministic distance mocking (no external API calls)
 * - Controlled test scenarios
 * - Verifiable algorithm behavior
 * - Performance validation
 */

import { ClarkeWrightSolver } from "../clarkeWrightSolver";
import { ALNSSolver } from "../alnsSolver";
import { distanceCacheService } from "../../routing/distanceCacheService";
import { Order } from "../../../entities/Order";
import { Driver } from "../../../entities/Driver";
import { DraftGroup } from "../../../entities/DraftGroup";
import { Point } from "geojson";
import { Location } from "../../../interfaces/Location";

// Mock distanceCacheService
jest.mock("../../routing/distanceCacheService", () => ({
  distanceCacheService: {
    getDistanceWithCache: jest.fn(),
  },
}));

/**
 * Test Helpers
 */

interface TestLocation {
  lat: number;
  lng: number;
}

const createMockOrder = (
  id: string,
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  priority: number = 1.0
): Order => {
  const order = {
    id,
    pickupLocation: {
      type: "Point",
      coordinates: [pickupLng, pickupLat], // GeoJSON is [lng, lat]
    } as Point,
    pickupAddress: `Pickup ${id}`,
    dropoffLocation: {
      type: "Point",
      coordinates: [dropoffLng, dropoffLat],
    } as Point,
    dropoffAddress: `Dropoff ${id}`,
    requestedDeliveryDate: new Date(),
    preferredTimeSlot: undefined,
    status: "PENDING" as any,
    priority,
    value: 0,
    priorityMultiplier: 1.0,
    rejectedDriverIds: [],
    rejectionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    getPriorityScore(): number {
      return this.priority * this.priorityMultiplier;
    },
  } as Order;

  return order;
};

const createMockDriver = (
  id: string,
  name: string,
  maxOrders: number
): Driver => {
  return {
    id,
    name,
    maxOrders,
  } as Driver;
};

/**
 * Distance Calculation Mocking
 *
 * Provides deterministic distance calculations based on Euclidean distance
 * scaled to meters. This ensures predictable and testable results.
 */
const mockEuclideanDistance = () => {
  (distanceCacheService.getDistanceWithCache as jest.Mock).mockImplementation(
    async (from: Location, to: Location) => {
      // Calculate Euclidean distance (scaled as meters)
      const latDiff = to.lat - from.lat;
      const lngDiff = to.lng - from.lng;
      const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 10000; // Scale to meters
      const duration = distance / 10; // Assume 10 m/s avg speed → duration in seconds

      return {
        distance,
        duration,
      };
    }
  );
};

/**
 * Custom Distance Matrix Mock
 *
 * Allows full control over distance calculations for specific test scenarios
 */
const mockCustomDistances = (
  distanceMatrix: Map<string, Map<string, number>>
) => {
  (distanceCacheService.getDistanceWithCache as jest.Mock).mockImplementation(
    async (from: Location, to: Location) => {
      const key1 = `${from.lat},${from.lng}`;
      const key2 = `${to.lat},${to.lng}`;

      const distance =
        distanceMatrix.get(key1)?.get(key2) ??
        distanceMatrix.get(key2)?.get(key1) ??
        1000; // Default fallback

      return {
        distance,
        duration: distance / 10,
      };
    }
  );
};

/**
 * ========================================================================
 * CLARKE-WRIGHT ALGORITHM TESTS
 * ========================================================================
 */

describe("ClarkeWrightSolver - Core Algorithm", () => {
  let solver: ClarkeWrightSolver;

  beforeEach(() => {
    solver = new ClarkeWrightSolver();
    jest.clearAllMocks();
  });

  describe("Basic Functionality", () => {
    test("should handle single order assignment", async () => {
      mockEuclideanDistance();

      const orders = [createMockOrder("o1", 1, 1, 2, 2)];
      const drivers = [createMockDriver("d1", "Driver 1", 5)];

      const result = await solver.solve(orders, drivers, "session-1");

      expect(result.ordersCount).toBe(1);
      expect(result.driversCount).toBe(1);
      expect(result.metadata.algorithm).toBe("clarke-wright");
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].orderId).toBe("o1");
      expect(result.assignments[0].driverId).toBe("d1");
    });

    test("should distribute orders across multiple drivers", async () => {
      mockEuclideanDistance();

      const orders = [
        createMockOrder("o1", 1, 1, 2, 2),
        createMockOrder("o2", 5, 5, 6, 6),
        createMockOrder("o3", 10, 10, 11, 11),
      ];
      const drivers = [
        createMockDriver("d1", "Driver 1", 1),
        createMockDriver("d2", "Driver 2", 1),
        createMockDriver("d3", "Driver 3", 1),
      ];

      const result = await solver.solve(orders, drivers, "session-2");

      expect(result.ordersCount).toBe(3);
      expect(result.driversCount).toBe(3); // All drivers should be used
      expect(result.assignments).toHaveLength(3);
    });

    test("should throw error with no orders", async () => {
      const drivers = [createMockDriver("d1", "Driver 1", 5)];
      await expect(solver.solve([], drivers, "session-3")).rejects.toThrow(
        "No orders to assign"
      );
    });

    test("should throw error with no drivers", async () => {
      const orders = [createMockOrder("o1", 1, 1, 2, 2)];
      await expect(solver.solve(orders, [], "session-4")).rejects.toThrow(
        "No drivers available"
      );
    });
  });

  describe("Route Merging Logic", () => {
    test("should merge routes when savings are high", async () => {
      // Scenario: Two orders close together, far from depot
      // Order 1: Pickup (10, 0), Dropoff (20, 0)
      // Order 2: Pickup (21, 0), Dropoff (30, 0)
      // Dropoff1 → Pickup2 distance is very short (1 unit)

      const orders = [
        createMockOrder("o1", 10, 0, 20, 0),
        createMockOrder("o2", 21, 0, 30, 0),
      ];
      const drivers = [
        createMockDriver("d1", "Driver 1", 5),
        createMockDriver("d2", "Driver 2", 5),
      ];

      // Custom distance matrix to force merging
      const distanceMap = new Map<string, Map<string, number>>();

      // Depot will be at average of pickups: (15.5, 0)
      const depot = "0,15.5";

      // Large distances from depot to orders (makes merging attractive)
      distanceMap.set(
        depot,
        new Map([
          ["10,0", 10000], // Depot → O1 pickup
          ["21,0", 10000], // Depot → O2 pickup
          ["20,0", 10000], // Depot → O1 dropoff
          ["30,0", 10000], // Depot → O2 dropoff
        ])
      );

      // Small local distances (pickup → dropoff within order)
      distanceMap.set("10,0", new Map([["20,0", 1000]])); // O1 pickup → dropoff
      distanceMap.set("21,0", new Map([["30,0", 1000]])); // O2 pickup → dropoff

      // Critical: Very small distance between order1 dropoff and order2 pickup
      distanceMap.set("20,0", new Map([["21,0", 100]])); // O1 dropoff → O2 pickup (MERGE LINK)

      mockCustomDistances(distanceMap);

      const result = await solver.solve(orders, drivers, "session-merge");

      // Should merge into single route
      expect(result.driversCount).toBe(1);
      expect(result.ordersCount).toBe(2);

      // Verify both orders assigned to same driver
      const driverIds = new Set(result.assignments.map((a) => a.driverId));
      expect(driverIds.size).toBe(1);
    });

    test("should NOT merge routes when capacity is exceeded", async () => {
      mockEuclideanDistance();

      const orders = [
        createMockOrder("o1", 10, 0, 20, 0),
        createMockOrder("o2", 21, 0, 30, 0),
      ];
      const drivers = [
        createMockDriver("d1", "Driver 1", 1), // Capacity: 1 order only
        createMockDriver("d2", "Driver 2", 1),
      ];

      const result = await solver.solve(orders, drivers, "session-no-merge");

      // Should NOT merge due to capacity constraint
      expect(result.driversCount).toBe(2);
      expect(result.ordersCount).toBe(2);
    });

    test("should respect driver rejection history", async () => {
      mockEuclideanDistance();

      const rejectedOrder = createMockOrder("o1", 1, 1, 2, 2);
      rejectedOrder.rejectedDriverIds = ["d1"]; // Driver 1 has rejected this

      const orders = [rejectedOrder];
      const drivers = [
        createMockDriver("d1", "Driver 1", 5),
        createMockDriver("d2", "Driver 2", 5),
      ];

      const result = await solver.solve(orders, drivers, "session-rejection");

      expect(result.ordersCount).toBe(1);
      // Should be assigned to d2, not d1
      expect(result.assignments[0].driverId).toBe("d2");
    });
  });

  describe("Performance and Metrics", () => {
    test("should calculate correct metrics for single route", async () => {
      mockEuclideanDistance();

      const orders = [
        createMockOrder("o1", 1, 1, 2, 2),
        createMockOrder("o2", 3, 3, 4, 4),
      ];
      const drivers = [createMockDriver("d1", "Driver 1", 5)];

      const result = await solver.solve(orders, drivers, "session-metrics");

      expect(result.totalDistance).toBeGreaterThan(0);
      expect(result.totalTravelTime).toBeGreaterThan(0);
      expect(result.averagePickupTime).toBeGreaterThan(0);
      expect(result.metadata.computationTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.qualityScore).toBeGreaterThan(0);
      expect(result.metadata.qualityScore).toBeLessThanOrEqual(1);
    });

    test("should complete within reasonable time for 20 orders", async () => {
      mockEuclideanDistance();

      const orders = Array.from({ length: 20 }, (_, i) =>
        createMockOrder(`o${i}`, i, i, i + 1, i + 1)
      );
      const drivers = Array.from({ length: 5 }, (_, i) =>
        createMockDriver(`d${i}`, `Driver ${i}`, 10)
      );

      const startTime = Date.now();
      const result = await solver.solve(orders, drivers, "session-perf");
      const duration = Date.now() - startTime;

      expect(result.ordersCount).toBe(20);
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
      expect(result.metadata.computationTimeMs).toBeLessThan(5000);
    });
  });

  describe("Edge Cases", () => {
    test("should handle all orders rejected by all drivers", async () => {
      mockEuclideanDistance();

      const rejectedOrder = createMockOrder("o1", 1, 1, 2, 2);
      rejectedOrder.rejectedDriverIds = ["d1", "d2"];

      const orders = [rejectedOrder];
      const drivers = [
        createMockDriver("d1", "Driver 1", 5),
        createMockDriver("d2", "Driver 2", 5),
      ];

      const result = await solver.solve(
        orders,
        drivers,
        "session-all-rejected"
      );

      // Order cannot be assigned - should result in 0 orders
      expect(result.ordersCount).toBe(0);
      expect(result.assignments).toHaveLength(0);
    });

    test("should handle more orders than driver maxOrders (concurrent capacity)", async () => {
      mockEuclideanDistance();

      const orders = Array.from({ length: 10 }, (_, i) =>
        createMockOrder(`o${i}`, i, i, i + 1, i + 1)
      );
      const drivers = [
        createMockDriver("d1", "Driver 1", 3), // Concurrent capacity: 3
        createMockDriver("d2", "Driver 2", 3),
      ];

      const result = await solver.solve(orders, drivers, "session-overflow");

      // All 10 orders can be assigned (distributed across 2 drivers)
      // maxOrders=3 means max 3 concurrent, not max 3 total per route
      expect(result.ordersCount).toBe(10);

      // The actual capacity constraint is enforced during stop sequence optimization
      // ensuring no driver carries more than 3 orders at once
    });
  });
});

/**
 * ========================================================================
 * ALNS ALGORITHM TESTS
 * ========================================================================
 */

describe("ALNSSolver - Core Algorithm", () => {
  let solver: ALNSSolver;
  let cwSolver: ClarkeWrightSolver;

  beforeEach(() => {
    solver = new ALNSSolver();
    cwSolver = new ClarkeWrightSolver();
    jest.clearAllMocks();
  });

  describe("Solution Improvement", () => {
    test("should improve or maintain initial solution quality", async () => {
      mockEuclideanDistance();

      const orders = [
        createMockOrder("o1", 1, 1, 2, 2),
        createMockOrder("o2", 3, 3, 4, 4),
        createMockOrder("o3", 5, 5, 6, 6),
      ];
      const drivers = [
        createMockDriver("d1", "Driver 1", 5),
        createMockDriver("d2", "Driver 2", 5),
      ];

      // Generate initial solution with Clarke-Wright
      const initialSolution = await cwSolver.solve(
        orders,
        drivers,
        "session-alns-init"
      );

      // Improve with ALNS
      const improvedSolution = await solver.improve(
        initialSolution,
        orders,
        drivers,
        "session-alns-improve",
        1000 // 1 second time limit
      );

      expect(improvedSolution.ordersCount).toBeGreaterThanOrEqual(
        initialSolution.ordersCount
      );

      // ALNS should improve or maintain quality
      expect(improvedSolution.totalDistance).toBeLessThanOrEqual(
        initialSolution.totalDistance * 1.05 // Allow 5% tolerance
      );

      expect(improvedSolution.metadata.algorithm).toBe("alns");
    });

    test("should respect capacity constraints during improvement", async () => {
      mockEuclideanDistance();

      const orders = [
        createMockOrder("o1", 1, 1, 2, 2),
        createMockOrder("o2", 3, 3, 4, 4),
        createMockOrder("o3", 5, 5, 6, 6),
      ];
      const drivers = [
        createMockDriver("d1", "Driver 1", 2),
        createMockDriver("d2", "Driver 2", 2),
      ];

      const initialSolution = await cwSolver.solve(
        orders,
        drivers,
        "session-cap-init"
      );
      const improvedSolution = await solver.improve(
        initialSolution,
        orders,
        drivers,
        "session-cap-improve",
        1000
      );

      // Verify capacity constraints
      const ordersPerDriver = new Map<string, number>();
      improvedSolution.assignments.forEach((a) => {
        ordersPerDriver.set(
          a.driverId,
          (ordersPerDriver.get(a.driverId) || 0) + 1
        );
      });

      ordersPerDriver.forEach((count, driverId) => {
        const driver = drivers.find((d) => d.id === driverId);
        expect(count).toBeLessThanOrEqual(driver?.maxOrders || 0);
      });
    });

    test("should handle time limit correctly", async () => {
      mockEuclideanDistance();

      const orders = Array.from({ length: 15 }, (_, i) =>
        createMockOrder(`o${i}`, i, i, i + 1, i + 1)
      );
      const drivers = Array.from({ length: 3 }, (_, i) =>
        createMockDriver(`d${i}`, `Driver ${i}`, 10)
      );

      const initialSolution = await cwSolver.solve(
        orders,
        drivers,
        "session-time-init"
      );

      const startTime = Date.now();
      const improvedSolution = await solver.improve(
        initialSolution,
        orders,
        drivers,
        "session-time-improve",
        500 // 500ms time limit
      );
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(700); // Should respect time limit (with small buffer)
      expect(improvedSolution.metadata.computationTimeMs).toBeLessThan(700);
    });
  });

  describe("Destroy-Repair Operations", () => {
    test("should successfully destroy and repair routes", async () => {
      mockEuclideanDistance();

      const orders = [
        createMockOrder("o1", 1, 1, 2, 2),
        createMockOrder("o2", 3, 3, 4, 4),
        createMockOrder("o3", 5, 5, 6, 6),
        createMockOrder("o4", 7, 7, 8, 8),
      ];
      const drivers = [createMockDriver("d1", "Driver 1", 10)];

      const initialSolution = await cwSolver.solve(
        orders,
        drivers,
        "session-dr-init"
      );
      const improvedSolution = await solver.improve(
        initialSolution,
        orders,
        drivers,
        "session-dr-improve",
        1000
      );

      // All orders should remain assigned
      expect(improvedSolution.ordersCount).toBe(4);
      expect(improvedSolution.assignments).toHaveLength(4);
    });

    test("should handle empty initial solution", async () => {
      mockEuclideanDistance();

      const orders = [
        createMockOrder("o1", 1, 1, 2, 2),
        createMockOrder("o2", 3, 3, 4, 4),
      ];
      const drivers = [createMockDriver("d1", "Driver 1", 5)];

      // Create empty initial solution
      const emptyInitial = new DraftGroup();
      emptyInitial.sessionId = "empty-session";
      emptyInitial.totalDistance = 0;
      emptyInitial.totalTravelTime = 0;
      emptyInitial.averagePickupTime = 0;
      emptyInitial.ordersCount = 0;
      emptyInitial.driversCount = 0;
      emptyInitial.assignments = [];
      emptyInitial.metadata = {
        algorithm: "clarke-wright",
        computationTimeMs: 0,
        qualityScore: 0,
        constraintsViolated: [],
      };

      const result = await solver.improve(
        emptyInitial,
        orders,
        drivers,
        "session-empty-improve",
        1000
      );

      // Should create a valid solution from scratch
      expect(result.ordersCount).toBeGreaterThan(0);
    });
  });

  describe("Adaptive Operator Selection", () => {
    test("should execute multiple iterations", async () => {
      mockEuclideanDistance();

      const orders = Array.from({ length: 10 }, (_, i) =>
        createMockOrder(`o${i}`, i, i, i + 1, i + 1)
      );
      const drivers = Array.from({ length: 3 }, (_, i) =>
        createMockDriver(`d${i}`, `Driver ${i}`, 5)
      );

      const initialSolution = await cwSolver.solve(
        orders,
        drivers,
        "session-iter-init"
      );
      const improvedSolution = await solver.improve(
        initialSolution,
        orders,
        drivers,
        "session-iter-improve",
        2000 // Longer time for more iterations
      );

      expect(improvedSolution.metadata.computationTimeMs).toBeGreaterThan(0);
      expect(improvedSolution.ordersCount).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    test("should handle single order", async () => {
      mockEuclideanDistance();

      const orders = [createMockOrder("o1", 1, 1, 2, 2)];
      const drivers = [createMockDriver("d1", "Driver 1", 5)];

      const initialSolution = await cwSolver.solve(
        orders,
        drivers,
        "session-single-init"
      );
      const improvedSolution = await solver.improve(
        initialSolution,
        orders,
        drivers,
        "session-single-improve",
        500
      );

      expect(improvedSolution.ordersCount).toBe(1);
      expect(improvedSolution.assignments[0].orderId).toBe("o1");
    });

    test("should handle rejected orders", async () => {
      mockEuclideanDistance();

      const rejectedOrder = createMockOrder("o1", 1, 1, 2, 2);
      rejectedOrder.rejectedDriverIds = ["d2"];

      const orders = [rejectedOrder, createMockOrder("o2", 3, 3, 4, 4)];
      const drivers = [
        createMockDriver("d1", "Driver 1", 5),
        createMockDriver("d2", "Driver 2", 5),
      ];

      const initialSolution = await cwSolver.solve(
        orders,
        drivers,
        "session-rej-init"
      );
      const improvedSolution = await solver.improve(
        initialSolution,
        orders,
        drivers,
        "session-rej-improve",
        1000
      );

      // Verify rejected order is assigned to correct driver
      const o1Assignment = improvedSolution.assignments.find(
        (a) => a.orderId === "o1"
      );
      expect(o1Assignment?.driverId).not.toBe("d2");
    });
  });
});

/**
 * ========================================================================
 * INTEGRATION TESTS - Both Algorithms Together
 * ========================================================================
 */

describe("Algorithm Integration - Clarke-Wright + ALNS", () => {
  let cwSolver: ClarkeWrightSolver;
  let alnsSolver: ALNSSolver;

  beforeEach(() => {
    cwSolver = new ClarkeWrightSolver();
    alnsSolver = new ALNSSolver();
    jest.clearAllMocks();
  });

  test("should produce better results with ALNS improvement", async () => {
    mockEuclideanDistance();

    const orders = Array.from({ length: 15 }, (_, i) =>
      createMockOrder(
        `o${i}`,
        i % 5,
        Math.floor(i / 5),
        (i % 5) + 1,
        Math.floor(i / 5) + 1
      )
    );
    const drivers = Array.from({ length: 4 }, (_, i) =>
      createMockDriver(`d${i}`, `Driver ${i}`, 5)
    );

    // Clarke-Wright initial solution
    const cwSolution = await cwSolver.solve(orders, drivers, "session-cw");

    // ALNS improvement
    const alnsSolution = await alnsSolver.improve(
      cwSolution,
      orders,
      drivers,
      "session-alns",
      2000
    );

    // ALNS should not degrade solution
    expect(alnsSolution.ordersCount).toBeGreaterThanOrEqual(
      cwSolution.ordersCount
    );
    expect(alnsSolution.totalDistance).toBeLessThanOrEqual(
      cwSolution.totalDistance * 1.1 // 10% tolerance
    );
  });

  test("should maintain feasibility across both algorithms", async () => {
    mockEuclideanDistance();

    const orders = [
      createMockOrder("o1", 1, 1, 2, 2, 1.5), // High priority
      createMockOrder("o2", 3, 3, 4, 4, 1.0),
      createMockOrder("o3", 5, 5, 6, 6, 0.8),
    ];
    const drivers = [
      createMockDriver("d1", "Driver 1", 2),
      createMockDriver("d2", "Driver 2", 2),
    ];

    const cwSolution = await cwSolver.solve(orders, drivers, "session-feas-cw");
    const alnsSolution = await alnsSolver.improve(
      cwSolution,
      orders,
      drivers,
      "session-feas-alns",
      1000
    );

    // Verify capacity constraints in both solutions
    const verifySolution = (solution: DraftGroup) => {
      const ordersPerDriver = new Map<string, number>();
      solution.assignments.forEach((a) => {
        ordersPerDriver.set(
          a.driverId,
          (ordersPerDriver.get(a.driverId) || 0) + 1
        );
      });

      ordersPerDriver.forEach((count, driverId) => {
        const driver = drivers.find((d) => d.id === driverId);
        expect(count).toBeLessThanOrEqual(driver?.maxOrders || 0);
      });
    };

    verifySolution(cwSolution);
    verifySolution(alnsSolution);
  });

  test("should handle complex real-world scenario", async () => {
    mockEuclideanDistance();

    // Simulate a real scenario: 25 orders, 6 drivers, varying capacities
    const orders = Array.from({ length: 25 }, (_, i) => {
      const cluster = i % 5;
      return createMockOrder(
        `o${i}`,
        cluster * 2 + (Math.random() - 0.5),
        cluster * 2 + (Math.random() - 0.5),
        cluster * 2 + 1 + (Math.random() - 0.5),
        cluster * 2 + 1 + (Math.random() - 0.5),
        1 + Math.random() * 0.5
      );
    });

    const drivers = [
      createMockDriver("d1", "Driver 1", 6),
      createMockDriver("d2", "Driver 2", 6),
      createMockDriver("d3", "Driver 3", 5),
      createMockDriver("d4", "Driver 4", 5),
      createMockDriver("d5", "Driver 5", 4),
      createMockDriver("d6", "Driver 6", 4),
    ];

    const cwSolution = await cwSolver.solve(orders, drivers, "session-real-cw");
    const alnsSolution = await alnsSolver.improve(
      cwSolution,
      orders,
      drivers,
      "session-real-alns",
      3000
    );

    // Verify both complete successfully
    expect(cwSolution.ordersCount).toBeGreaterThan(0);
    expect(alnsSolution.ordersCount).toBeGreaterThan(0);

    // ALNS should provide comparable or better solution
    const cwCost =
      cwSolution.totalDistance +
      (orders.length - cwSolution.ordersCount) * 100000;
    const alnsCost =
      alnsSolution.totalDistance +
      (orders.length - alnsSolution.ordersCount) * 100000;

    expect(alnsCost).toBeLessThanOrEqual(cwCost * 1.1); // Within 10%
  });
});
