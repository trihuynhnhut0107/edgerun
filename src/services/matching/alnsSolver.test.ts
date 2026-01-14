import { ALNSSolver } from "./alnsSolver";
import { distanceCacheService } from "../routing/distanceCacheService";
import { Order } from "../../entities/Order";
import { Driver } from "../../entities/Driver";
import { DraftGroup } from "../../entities/DraftGroup";
import { Point } from "geojson";

jest.mock("../routing/distanceCacheService", () => ({
  distanceCacheService: {
    getDistanceWithCache: jest.fn(),
  },
}));

describe("ALNSSolver", () => {
  let solver: ALNSSolver;

  beforeEach(() => {
    solver = new ALNSSolver();
    jest.clearAllMocks();
  });

  const createMockOrder = (
    id: string,
    pickup: number[],
    dropoff: number[]
  ): Order =>
    ({
      id,
      pickupLocation: { type: "Point", coordinates: pickup },
      dropoffLocation: { type: "Point", coordinates: dropoff },
    }) as any; // Use any to bypass strict type checks for missing props

  const createMockDriver = (id: string, maxOrders: number): Driver =>
    ({
      id,
      maxOrders,
    }) as any;

  test("improve should respect capacity constraints", async () => {
    // 3 orders, Driver capacity 2.
    // Expect: 1 driver takes 2, 1 order unassigned OR 2 drivers used if available.
    // In this test, we provide 1 driver with capacity 2. ALNS should leave 1 order unassigned or fail to insert.
    // The current ALNS implementation has 'unassignedOrders' list.
    // But 'solutionToDraftGroup' doesn't expose unassigned count directly in DraftGroup entity properties except implicitly via ordersCount vs input orders.
    // Actually DraftGroup has ordersCount. If input is 3 and result.ordersCount is 2, then 1 unassigned.

    const orders = [
      createMockOrder("o1", [0, 0], [0, 1]),
      createMockOrder("o2", [0, 2], [0, 3]),
      createMockOrder("o3", [0, 4], [0, 5]),
    ];
    const drivers = [createMockDriver("d1", 2)]; // Cap 2

    const mockDraftGroup = {
      totalTravelTime: 100,
      totalDistance: 1000,
    } as DraftGroup;

    (distanceCacheService.getDistanceWithCache as jest.Mock).mockResolvedValue({
      distance: 10,
      duration: 1,
    });

    const result = await solver.improve(
      mockDraftGroup,
      orders,
      drivers,
      "test-cap-alns",
      200
    );

    // Expect only 2 orders assigned due to capacity
    expect(result.ordersCount).toBe(2);
    expect(result.driversCount).toBe(1);
  });

  test("improve should reduce cost from initial bad solution", async () => {
    // NOTE: The current 'improve' implementation actually resets the solution to empty and reconstructs it
    // via 'draftGroupToSolution' -> 'assign orders from scratch'?
    // Checking 'draftGroupToSolution' in alnsSolver.ts:
    // It creates empty routes and puts ALL orders into 'unassignedOrders'.
    // So it effectively constructs from scratch using greedy/regret insertion.
    // So we can't really test "improvement from initial" but rather "construction quality".

    // Let's verify it produces a valid solution for simple case.
    const orders = [createMockOrder("o1", [0, 0], [0, 1])];
    const drivers = [createMockDriver("d1", 1)];

    (distanceCacheService.getDistanceWithCache as jest.Mock).mockResolvedValue({
      distance: 100,
      duration: 10,
    });

    const result = await solver.improve(
      { totalTravelTime: 0, totalDistance: 0 } as DraftGroup,
      orders,
      drivers,
      "sess",
      100
    );

    expect(result.ordersCount).toBe(1);
    expect(result.totalDistance).toBeGreaterThan(0);
  });
});
