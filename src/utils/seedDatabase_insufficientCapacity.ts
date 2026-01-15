/**
 * Test Case: Insufficient Driver Capacity
 * Tests matching engine behavior when total capacity < total orders
 *
 * Usage: npx ts-node src/utils/seedDatabase_insufficientCapacity.ts
 *
 * Scenario:
 * - 5 drivers with capacity of 3 each = 15 total capacity
 * - 25 orders (10 more than capacity)
 * - Tests if algorithm handles capacity constraints properly
 * - Some orders should remain PENDING/unassigned
 */

import "reflect-metadata";
import { AppDataSource } from "../config/ormconfig";
import { driverService } from "../services/driver/driver.service";
import { customerService } from "../services/customer/customer.service";
import { orderService } from "../services/order/order.service";
import { DriverStatus } from "../enums/DriverStatus";
import { OrderStatus } from "../enums/OrderStatus";

const MANHATTAN_NEIGHBORHOODS = {
  midtown: { lat: 40.758, lng: -73.9855, name: "Midtown Manhattan" },
  upperWest: { lat: 40.787, lng: -73.9754, name: "Upper West Side" },
  chelsea: { lat: 40.7465, lng: -74.0014, name: "Chelsea" },
  westVillage: { lat: 40.7358, lng: -74.0036, name: "West Village" },
  eastVillage: { lat: 40.7264, lng: -73.9818, name: "East Village" },
  soho: { lat: 40.7233, lng: -74.0027, name: "SoHo" },
  gramercy: { lat: 40.7369, lng: -73.9844, name: "Gramercy Park" },
};

const seedDatabase = async () => {
  try {
    console.log(
      "\n═══════════════════════════════════════════════════════════"
    );
    console.log("🧪 TEST CASE: Insufficient Driver Capacity");
    console.log(
      "═══════════════════════════════════════════════════════════\n"
    );

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("✓ Database connection established");
    }

    // Clean up existing data
    console.log("🧹 Cleaning up existing data...");
    const existingDrivers = await driverService.getAllDrivers();
    const existingCustomers = await customerService.getAllCustomers();

    if (existingDrivers.length > 0 || existingCustomers.length > 0) {
      const driverRepo = AppDataSource.getRepository("Driver");
      const customerRepo = AppDataSource.getRepository("Customer");
      const orderRepo = AppDataSource.getRepository("Order");
      const assignmentRepo = AppDataSource.getRepository("OrderAssignment");
      const locationRepo = AppDataSource.getRepository("DriverLocation");
      const timeWindowRepo = AppDataSource.getRepository("TimeWindow");
      const observationRepo = AppDataSource.getRepository(
        "RouteSegmentObservation"
      );

      const timeWindows = await timeWindowRepo.find();
      const assignments = await assignmentRepo.find();
      const orders = await orderRepo.find();
      const observations = await observationRepo.find();
      const locations = await locationRepo.find();

      if (timeWindows.length > 0) await timeWindowRepo.remove(timeWindows);
      if (assignments.length > 0) await assignmentRepo.remove(assignments);
      if (observations.length > 0) await observationRepo.remove(observations);
      if (locations.length > 0) await locationRepo.remove(locations);
      if (orders.length > 0) await orderRepo.remove(orders);
      if (existingDrivers.length > 0) await driverRepo.remove(existingDrivers);
      if (existingCustomers.length > 0)
        await customerRepo.remove(existingCustomers);

      console.log("✓ Database cleaned\n");
    }

    // Create 5 customers
    console.log("👥 Creating 5 customers...\n");
    const customers = [];
    const customerNames = [
      "Alice Johnson",
      "Bob Smith",
      "Carol White",
      "David Brown",
      "Emma Davis",
    ];

    const neighborhoodKeys = Object.keys(MANHATTAN_NEIGHBORHOODS);
    for (let i = 0; i < customerNames.length; i++) {
      const neighborhoodKey = neighborhoodKeys[i % neighborhoodKeys.length];
      const neighborhood =
        MANHATTAN_NEIGHBORHOODS[
          neighborhoodKey as keyof typeof MANHATTAN_NEIGHBORHOODS
        ];

      const customer = await customerService.createCustomer({
        name: customerNames[i],
        email: `${customerNames[i].toLowerCase().replace(" ", ".")}@test.com`,
        phone: `+1555${String(3000 + i).padStart(7, "0")}`,
        defaultAddress: `${700 + i} ${neighborhood.name}, Manhattan, NY`,
        defaultLocation: {
          lat: neighborhood.lat + (Math.random() - 0.5) * 0.003,
          lng: neighborhood.lng + (Math.random() - 0.5) * 0.003,
        },
      });
      customers.push(customer);
    }
    console.log(`✓ Created ${customers.length} customers\n`);

    // Create 3 drivers with capacity of 2 each = 6 total (LESS than 10 orders)
    console.log("🚗 Creating 3 drivers (2 orders capacity each)...\n");
    const driverNames = [
      "Limited Driver 1",
      "Limited Driver 2",
      "Limited Driver 3",
    ];

    let totalCapacity = 0;
    for (let i = 0; i < driverNames.length; i++) {
      const neighborhoodKey = neighborhoodKeys[i % neighborhoodKeys.length];
      const location =
        MANHATTAN_NEIGHBORHOODS[
          neighborhoodKey as keyof typeof MANHATTAN_NEIGHBORHOODS
        ];

      const driver = await driverService.createDriver({
        name: driverNames[i],
        phone: `+1555${String(4000 + i).padStart(7, "0")}`,
        vehicleType: "car",
        maxOrders: 2, // Only 2 orders per driver
        initialLocation: {
          lat: location.lat + (Math.random() - 0.5) * 0.003,
          lng: location.lng + (Math.random() - 0.5) * 0.003,
        },
      });

      const driverRepo = AppDataSource.getRepository("Driver");
      driver.status = DriverStatus.AVAILABLE;
      await driverRepo.save(driver);

      totalCapacity += 2;
      console.log(
        `  ✓ ${driverNames[i].padEnd(20)} | Capacity: 2 | ${location.name}`
      );
    }
    console.log(`\n  📊 Total capacity: ${totalCapacity} orders`);
    console.log(`  ⚠️  Insufficient capacity for 10 orders!\n`);

    // Create 10 orders (4 MORE than total capacity of 6)
    console.log("📦 Creating 10 orders (exceeds capacity by 4)...\n");
    for (let i = 0; i < 10; i++) {
      const pickupKey = neighborhoodKeys[i % neighborhoodKeys.length];
      const dropoffKey = neighborhoodKeys[(i + 3) % neighborhoodKeys.length];

      const pickupLocation =
        MANHATTAN_NEIGHBORHOODS[
          pickupKey as keyof typeof MANHATTAN_NEIGHBORHOODS
        ];
      const dropoffLocation =
        MANHATTAN_NEIGHBORHOODS[
          dropoffKey as keyof typeof MANHATTAN_NEIGHBORHOODS
        ];

      const deliveryDate = new Date();
      deliveryDate.setHours(deliveryDate.getHours() + 2);

      // Vary priorities to test if high-priority orders get assigned first
      const priority = i < 4 ? 10 : i < 8 ? 5 : 1; // 4 high, 4 medium, 2 low priority

      const order = await orderService.createOrder({
        pickupLat: pickupLocation.lat + (Math.random() - 0.5) * 0.005,
        pickupLng: pickupLocation.lng + (Math.random() - 0.5) * 0.005,
        pickupAddress: `${800 + i} ${pickupLocation.name}, Manhattan, NY`,
        dropoffLat: dropoffLocation.lat + (Math.random() - 0.5) * 0.005,
        dropoffLng: dropoffLocation.lng + (Math.random() - 0.5) * 0.005,
        dropoffAddress: `${900 + i} ${dropoffLocation.name}, Manhattan, NY`,
        requestedDeliveryDate: deliveryDate,
        preferredTimeSlot: "afternoon",
        priority,
        customerId: i < 7 ? customers[i % customers.length].id : undefined,
      });

      const orderRepo = AppDataSource.getRepository("Order");
      order.status = OrderStatus.PENDING;
      await orderRepo.save(order);
    }
    console.log("✓ Created 10 orders\n");

    console.log("═══════════════════════════════════════════════════════════");
    console.log("✓ Test case seeding completed!");
    console.log(
      "═══════════════════════════════════════════════════════════\n"
    );
    console.log("📊 Test Setup:");
    console.log("   • 3 drivers × 2 capacity = 6 total capacity");
    console.log("   • 10 orders (4 more than capacity)");
    console.log("   • Capacity deficit: -4 orders");
    console.log("   • Priority distribution: 4 high, 4 medium, 2 low");
    console.log("\n🧪 Expected Behavior:");
    console.log("   • Maximum 6 orders can be assigned");
    console.log("   • At least 4 orders remain PENDING/unassigned");
    console.log("   • High-priority orders should be assigned first");
    console.log("   • Test graceful handling of capacity constraints\n");
  } catch (error) {
    console.error("\n✗ Seeding failed:", error);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
};

seedDatabase();
