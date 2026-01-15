/**
 * Test Case: Driver Too Far From Order Area
 * Tests matching engine behavior when one driver is geographically isolated
 *
 * Usage: npx ts-node src/utils/seedDatabase_farDriver.ts
 *
 * Scenario:
 * - 9 drivers in Manhattan (close to orders)
 * - 1 driver in Queens (15+ km away from most orders)
 * - 30 orders concentrated in Manhattan
 * - Tests if algorithm avoids assigning to far driver or assigns strategically
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
};

// Far away location in Queens
const QUEENS_LOCATION = {
  lat: 40.7282,
  lng: -73.7949,
  name: "Queens (Far Away)",
};

const seedDatabase = async () => {
  try {
    console.log(
      "\n═══════════════════════════════════════════════════════════"
    );
    console.log("🧪 TEST CASE: Driver Too Far From Order Area");
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
        phone: `+1555${String(2000 + i).padStart(7, "0")}`,
        defaultAddress: `${400 + i} ${neighborhood.name}, Manhattan, NY`,
        defaultLocation: {
          lat: neighborhood.lat + (Math.random() - 0.5) * 0.003,
          lng: neighborhood.lng + (Math.random() - 0.5) * 0.003,
        },
      });
      customers.push(customer);
    }
    console.log(`✓ Created ${customers.length} customers\n`);

    // Create 4 drivers: 3 in Manhattan, 1 in Queens (far away)
    console.log("🚗 Creating 4 drivers (3 Manhattan, 1 Queens)...\n");
    const driverNames = [
      "Driver Manhattan 1",
      "Driver Manhattan 2",
      "Driver Manhattan 3",
      "Driver Queens (FAR)",
    ];

    let totalCapacity = 0;
    for (let i = 0; i < driverNames.length; i++) {
      const isFarDriver = i === 3;
      const location = isFarDriver
        ? QUEENS_LOCATION
        : MANHATTAN_NEIGHBORHOODS[
            neighborhoodKeys[
              i % neighborhoodKeys.length
            ] as keyof typeof MANHATTAN_NEIGHBORHOODS
          ];

      const driver = await driverService.createDriver({
        name: driverNames[i],
        phone: `+1555${String(1000 + i).padStart(7, "0")}`,
        vehicleType: "car",
        maxOrders: 3,
        initialLocation: {
          lat: location.lat + (Math.random() - 0.5) * 0.003,
          lng: location.lng + (Math.random() - 0.5) * 0.003,
        },
      });

      const driverRepo = AppDataSource.getRepository("Driver");
      driver.status = DriverStatus.AVAILABLE;
      await driverRepo.save(driver);

      totalCapacity += 3;
      console.log(
        `  ${isFarDriver ? "⚠️ " : "✓"} ${driverNames[i].padEnd(25)} | ${location.name}`
      );
    }
    console.log(`\n  📊 Total capacity: ${totalCapacity} orders\n`);

    // Create 10 orders all in Manhattan
    console.log("📦 Creating 10 orders (all in Manhattan)...\n");
    for (let i = 0; i < 10; i++) {
      const pickupKey = neighborhoodKeys[i % neighborhoodKeys.length];
      const dropoffKey = neighborhoodKeys[(i + 2) % neighborhoodKeys.length];

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

      const order = await orderService.createOrder({
        pickupLat: pickupLocation.lat + (Math.random() - 0.5) * 0.005,
        pickupLng: pickupLocation.lng + (Math.random() - 0.5) * 0.005,
        pickupAddress: `${500 + i} ${pickupLocation.name}, Manhattan, NY`,
        dropoffLat: dropoffLocation.lat + (Math.random() - 0.5) * 0.005,
        dropoffLng: dropoffLocation.lng + (Math.random() - 0.5) * 0.005,
        dropoffAddress: `${600 + i} ${dropoffLocation.name}, Manhattan, NY`,
        requestedDeliveryDate: deliveryDate,
        preferredTimeSlot: "morning",
        priority: Math.floor(Math.random() * 10) + 1,
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
    console.log("   • 3 drivers in Manhattan (close to orders)");
    console.log("   • 1 driver in Queens (~15km away from orders)");
    console.log("   • 10 orders all in Manhattan");
    console.log("   • Total capacity: 12 orders");
    console.log("\n🧪 Expected Behavior:");
    console.log("   • Queens driver should get 0 or minimal assignments");
    console.log("   • Manhattan drivers should handle most/all orders");
    console.log("   • Test algorithm's distance-based optimization\n");
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
