import { ClarkeWrightSolver } from "./clarkeWrightSolver";
import { distanceCacheService } from "../routing/distanceCacheService";
import { Order } from "../../entities/Order";
import { Driver } from "../../entities/Driver";
import { Point } from "geojson";

// Mock distanceCacheService
jest.mock("../routing/distanceCacheService", () => ({
  distanceCacheService: {
    getDistanceWithCache: jest.fn(),
  },
}));

describe("ClarkeWrightSolver", () => {
  let solver: ClarkeWrightSolver;

  beforeEach(() => {
    solver = new ClarkeWrightSolver();
    jest.clearAllMocks();
  });

  const createMockOrder = (
    id: string,
    pickup: number[],
    dropoff: number[]
  ): Order => {
    return {
      id,
      pickupLocation: { type: "Point", coordinates: pickup } as Point,
      dropoffLocation: { type: "Point", coordinates: dropoff } as Point,
    } as Order;
  };

  const createMockDriver = (id: string, maxOrders: number): Driver => {
    return {
      id,
      maxOrders,
    } as Driver;
  };

  test("solve should merge routes when savings are high", async () => {
    // Scenario:
    // Depot: (0,0) (Average of pickups)
    // Order 1: Pickup (10, 0), Dropoff (11, 0)
    // Order 2: Pickup (0, 10), Dropoff (0, 11)

    // We want to force a merge.
    // Savings S_ij = D(Depot, i) + D(Depot, j) - D(i, j)
    // For this to be high, i and j should be far from depot but close to each other.

    // Let's adjust coordinates to make them close clusters far from depot
    // Cluster 1: (10, 0) and (11, 0) are close.
    // Order A: Pickup (10, 0), Dropoff (10.1, 0)
    // Order B: Pickup (11, 0), Dropoff (11.1, 0)
    // Wait, Clarke Wright merges Route i and Route j.
    // Standard CW merges the end of one route to start of another.
    // i.e. ... -> Dropoff_i -> Pickup_j -> ...
    // So we need Dropoff_A to be close to Pickup_B.

    // Config:
    // Depot (0,0)
    // Order 1: Pickup (10,0), Dropoff (20,0) // Far out
    // Order 2: Pickup (21,0), Dropoff (10,0) // Close to O1 dropoff

    // Let's explicitly mock distances to control logic fully without coordinate math
    // Orders: o1, o2.
    // Drivers: d1, d2.

    const orders = [
      createMockOrder("o1", [10, 0], [20, 0]),
      createMockOrder("o2", [21, 0], [10, 0]),
    ];
    const drivers = [createMockDriver("d1", 5), createMockDriver("d2", 5)];

    // We need to support calls:
    // 1. Depot calculation: avg of pickups. (15.5, 0)
    // 2. getDistanceWithCache:
    //    - Depot -> Pickups (for savings)
    //    - Dropoff_i -> Pickup_j (for savings)
    //    - Route metrics: Depot -> P -> D -> Depot...

    // Let's use a simpler spy that returns low cost for o1_drop -> o2_pick

    (distanceCacheService.getDistanceWithCache as jest.Mock).mockImplementation(
      async (a, b) => {
        // Identify points by simple property check if possible, or coordinate matching
        const isDepot = (p: { lat: number; lng: number }) =>
          Math.abs(p.lat - 0) < 0.1 && Math.abs(p.lng - 15.5) < 0.1;

        // Mock specific path costs
        // o1 drop (20,0) -> o2 pick (21,0): distance 1
        if (a.lng === 20 && b.lng === 21) return { distance: 1, duration: 1 };

        // o2 drop (10,0) -> o1 pick (10,0): distance 0 (but we only merge end->start)
        if (a.lng === 10 && b.lng === 10) return { distance: 0, duration: 0 };

        // Depot -> Any Pickup: distance 100 (Far from depot)
        if (Math.abs(b.lng - 10) < 0.1 || Math.abs(b.lng - 21) < 0.1) {
          return { distance: 100, duration: 100 };
        }

        // Default small local distance for pickup->dropoff
        return { distance: 10, duration: 10 };
      }
    );

    const result = await solver.solve(orders, drivers, "test-merge");

    expect(result.ordersCount).toBe(2);
    // Should have 1 driver used if merged
    expect(result.driversCount).toBe(1);

    // Verify total distance
    // Route: Depot -> o1_pick -> o1_drop -> o2_pick -> o2_drop -> Depot
    // Costs:
    // Depot -> o1_pick: 100
    // o1_pick -> o1_drop: 10
    // o1_drop -> o2_pick: 1 (The saving link!)
    // o2_pick -> o2_drop: 10
    // o2_drop -> Depot: 100 (symmetric approx)
    // Total approx: 221

    // If NOT merged (2 routes):
    // R1: Depot -> o1_p -> o1_d -> Depot (100+10+100 = 210)
    // R2: Depot -> o2_p -> o2_d -> Depot (100+10+100 = 210)
    // Total: 420

    // So if result.totalDistance < 300, it definitely merged.
    expect(result.totalDistance).toBeLessThan(300);
  });

  test("solve should NOT merge if capacity exceeded", async () => {
    // Same scenario but capacity 1
    const orders = [
      createMockOrder("o1", [10, 0], [20, 0]),
      createMockOrder("o2", [21, 0], [10, 0]),
    ];
    // Drivers with capacity 1
    const drivers = [createMockDriver("d1", 1), createMockDriver("d2", 1)];

    (distanceCacheService.getDistanceWithCache as jest.Mock).mockImplementation(
      async (a, b) => {
        // Same mock logic
        if (a.lng === 20 && b.lng === 21) return { distance: 1, duration: 1 };
        if (Math.abs(b.lng - 10) < 0.1 || Math.abs(b.lng - 21) < 0.1)
          return { distance: 100, duration: 100 };
        return { distance: 10, duration: 10 };
      }
    );

    const result = await solver.solve(orders, drivers, "test-cap-split");

    // Should NOT merge
    expect(result.driversCount).toBe(2);
    expect(result.totalDistance).toBeGreaterThan(300); // 210 (R2) + 120 (R1) = 330
  });

  test("should throw error if no orders", async () => {
    await expect(
      solver.solve([], [createMockDriver("d1", 5)], "sid")
    ).rejects.toThrow("No orders to assign");
  });

  test("should throw error if no drivers", async () => {
    await expect(
      solver.solve([createMockOrder("o1", [0, 0], [0, 1])], [], "sid")
    ).rejects.toThrow("No drivers available");
  });
});
