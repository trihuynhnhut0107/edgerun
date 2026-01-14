import { DistanceCacheService } from "./distanceCacheService";
import { AppDataSource } from "../../config/ormconfig";
import * as mapboxClient from "./mapboxClient";
import { DistanceCache } from "../../entities/DistanceCache";
import { Location } from "../../interfaces/Location";

// Mock dependencies
jest.mock("../../config/ormconfig", () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock("./mapboxClient", () => ({
  getDistance: jest.fn(),
  getDistanceMatrix: jest.fn(),
}));

describe("DistanceCacheService", () => {
  let service: DistanceCacheService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 5 }),
      }),
      count: jest.fn(),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new DistanceCacheService();
    jest.clearAllMocks();
  });

  const locA: Location = { lat: 0, lng: 0 };
  const locB: Location = { lat: 1, lng: 1 };

  test("getDistanceWithCache should return cached value if present", async () => {
    mockRepo.findOne.mockResolvedValue({
      distance: 500,
      duration: 50,
    });

    const result = await service.getDistanceWithCache(locA, locB);

    expect(result).toEqual({ distance: 500, duration: 50 });
    expect(mockRepo.findOne).toHaveBeenCalled();
    expect(mapboxClient.getDistance).not.toHaveBeenCalled();
  });

  test("getDistanceWithCache should fetch from mapbox if miss", async () => {
    mockRepo.findOne.mockResolvedValue(null);
    (mapboxClient.getDistance as jest.Mock).mockResolvedValue({
      distance_m: 1000,
      duration_s: 100,
    });

    const result = await service.getDistanceWithCache(locA, locB);

    expect(result).toEqual({ distance: 1000, duration: 100 });
    expect(mapboxClient.getDistance).toHaveBeenCalled();
    expect(mockRepo.save).toHaveBeenCalled();
  });

  test("cleanExpiredCache should remove expired entries", async () => {
    await service.cleanExpiredCache();
    // Check if query builder was used correctly
    // Since mockRepo methods are chained, we verify that execute was called
    const deleteMock = mockRepo.createQueryBuilder().delete;
    const executeMock = mockRepo.createQueryBuilder().execute;

    // Check if createQueryBuilder was called on the repo instance
    expect(mockRepo.createQueryBuilder).toHaveBeenCalled();
    // Verify execution
    expect(executeMock).toHaveBeenCalled();
  });
});
