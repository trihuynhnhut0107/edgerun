/**
 * Database Setup Utility for Tests
 * Provides functions for cleaning up and seeding test data using existing CRUD services
 *
 * Usage:
 * - Call setupTestDatabase() before running tests
 * - Call cleanupTestDatabase() after tests complete
 */

import 'reflect-metadata';
import { AppDataSource } from '../config/ormconfig';
import { Order } from '../entities/Order';
import { Driver } from '../entities/Driver';
import { DriverLocation } from '../entities/DriverLocation';
import { orderService } from '../services/order/order.service';
import { driverService } from '../services/driver/driver.service';

export interface TestDataResult {
  orders: Order[];
  drivers: Driver[];
}

/**
 * Test locations across NYC neighborhoods
 */
const TEST_LOCATIONS = {
  midtown: { lat: 40.753, lng: -73.983 },
  brooklyn: { lat: 40.6501, lng: -73.9496 },
  queens: { lat: 40.7282, lng: -73.7949 },
  upperWest: { lat: 40.781, lng: -73.973 },
  lowerEast: { lat: 40.7144, lng: -73.9842 },
  chinatown: { lat: 40.7155, lng: -73.9975 },
  eastVillage: { lat: 40.7258, lng: -73.9805 },
  tribeca: { lat: 40.7161, lng: -74.009 },
  soho: { lat: 40.7233, lng: -74.0027 },
  nolita: { lat: 40.7202, lng: -73.9976 },
};

/**
 * Initialize database connection if not already initialized
 */
async function ensureDatabaseConnection(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

/**
 * Clean all test data from database using repositories
 * Deletes all orders, driver locations, and drivers
 */
export async function cleanupTestDatabase(): Promise<void> {
  await ensureDatabaseConnection();

  const orderRepo = AppDataSource.getRepository(Order);
  const driverRepo = AppDataSource.getRepository(Driver);
  const locationRepo = AppDataSource.getRepository(DriverLocation);

  // Fetch all records
  const [orders, drivers, locations] = await Promise.all([
    orderRepo.find(),
    driverRepo.find(),
    locationRepo.find(),
  ]);

  // Delete records if they exist
  if (locations.length > 0) {
    await locationRepo.remove(locations);
  }
  if (orders.length > 0) {
    await orderRepo.remove(orders);
  }
  if (drivers.length > 0) {
    await driverRepo.remove(drivers);
  }
}

/**
 * Setup test database with sample data
 * Cleans existing data and creates fresh test orders and drivers using CRUD services
 *
 * @param orderCount Number of test orders to create
 * @param driverCount Number of test drivers to create
 * @returns Object containing created orders and drivers
 */
export async function setupTestDatabase(
  orderCount: number = 15,
  driverCount: number = 5
): Promise<TestDataResult> {
  await ensureDatabaseConnection();
  await cleanupTestDatabase();

  const orders: Order[] = [];
  const drivers: Driver[] = [];

  const locationKeys = Object.keys(TEST_LOCATIONS) as Array<keyof typeof TEST_LOCATIONS>;

  // Create test orders using OrderService
  for (let i = 0; i < orderCount; i++) {
    const pickupLocationKey = locationKeys[i % locationKeys.length];
    const dropoffLocationKey = locationKeys[(i + 1) % locationKeys.length];

    const pickupLocation = TEST_LOCATIONS[pickupLocationKey];
    const dropoffLocation = TEST_LOCATIONS[dropoffLocationKey];

    const deliveryDate = new Date();
    const timeSlots = ['morning', 'afternoon', 'evening'];

    const order = await orderService.createOrder({
      pickupLat: pickupLocation.lat + (Math.random() - 0.5) * 0.005,
      pickupLng: pickupLocation.lng + (Math.random() - 0.5) * 0.005,
      pickupAddress: `Pickup Location ${i + 1} (${pickupLocationKey})`,
      dropoffLat: dropoffLocation.lat + (Math.random() - 0.5) * 0.005,
      dropoffLng: dropoffLocation.lng + (Math.random() - 0.5) * 0.005,
      dropoffAddress: `Dropoff Location ${i + 1} (${dropoffLocationKey})`,
      requestedDeliveryDate: deliveryDate,
      preferredTimeSlot: timeSlots[Math.floor(Math.random() * timeSlots.length)],
      priority: Math.floor(Math.random() * 10) + 1,
      value: Math.random() * 50 + 10,
    });

    orders.push(order);
  }

  // Create test drivers using DriverService
  for (let i = 0; i < driverCount; i++) {
    const baseLocationKey = locationKeys[i % locationKeys.length];
    const baseLocation = TEST_LOCATIONS[baseLocationKey];

    const driver = await driverService.createDriver({
      name: `Driver ${i + 1}`,
      phone: `555-${String(1000 + i).slice(-4)}`,
      vehicleType: ['bike', 'scooter', 'car'][i % 3],
      maxOrders: [2, 3, 4][i % 3],
      initialLocation: {
        lat: baseLocation.lat + (Math.random() - 0.5) * 0.01,
        lng: baseLocation.lng + (Math.random() - 0.5) * 0.01,
      },
    });

    drivers.push(driver);
  }

  return {
    orders,
    drivers,
  };
}

/**
 * Get a summary of current test data in database
 */
export async function getTestDatabaseSummary(): Promise<{
  orderCount: number;
  driverCount: number;
  locationCount: number;
}> {
  await ensureDatabaseConnection();

  const orderRepo = AppDataSource.getRepository(Order);
  const driverRepo = AppDataSource.getRepository(Driver);
  const locationRepo = AppDataSource.getRepository(DriverLocation);

  const [orders, drivers, locations] = await Promise.all([
    orderRepo.find(),
    driverRepo.find(),
    locationRepo.find(),
  ]);

  return {
    orderCount: orders.length,
    driverCount: drivers.length,
    locationCount: locations.length,
  };
}
