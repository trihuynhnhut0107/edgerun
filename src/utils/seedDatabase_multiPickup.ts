/**
 * Test Case: Multi-Pickup Before Delivery Pattern
 * Tests pickup -> pickup -> delivery -> delivery routing
 *
 * Usage: npx ts-node src/utils/seedDatabase_multiPickup.ts
 *
 * Scenario:
 * - 3 drivers with capacity of 3 each
 * - 9 orders strategically placed to encourage multi-pickup pattern
 * - Orders clustered in pickup zones and delivery zones
 * - Tests if algorithm can optimize: P1 -> P2 -> P3 -> D1 -> D2 -> D3
 * - More efficient than: P1 -> D1 -> P2 -> D2 -> P3 -> D3
 */

import "reflect-metadata";
import { AppDataSource } from "../config/ormconfig";
import { driverService } from "../services/driver/driver.service";
import { customerService } from "../services/customer/customer.service";
import { orderService } from "../services/order/order.service";
import { DriverStatus } from "../enums/DriverStatus";
import { OrderStatus } from "../enums/OrderStatus";

// Clustered locations to encourage multi-pickup patterns
const PICKUP_ZONE_WEST = {
  lat: 40.7465,
  lng: -74.0014,
  name: "Chelsea (Pickup Zone)",
};
const PICKUP_ZONE_EAST = {
  lat: 40.7264,
  lng: -73.9818,
  name: "East Village (Pickup Zone)",
};
const DELIVERY_ZONE_NORTH = {
  lat: 40.787,
  lng: -73.9754,
  name: "Upper West (Delivery Zone)",
};
const DELIVERY_ZONE_SOUTH = {
  lat: 40.7074,
  lng: -74.0113,
  name: "Financial District (Delivery Zone)",
};

const seedDatabase = async () => {
  try {
    console.log(
      "\n═══════════════════════════════════════════════════════════"
    );
    console.log("🧪 TEST CASE: Multi-Pickup Pattern (P-P-D-D)");
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
      "Alice Chen",
      "Bob Martinez",
      "Carol Kim",
      "David Patel",
      "Emma Wilson",
    ];

    for (let i = 0; i < customerNames.length; i++) {
      // Alternate customers between zones
      const zone = i % 2 === 0 ? PICKUP_ZONE_WEST : DELIVERY_ZONE_NORTH;

      const customer = await customerService.createCustomer({
        name: customerNames[i],
        email: `${customerNames[i].toLowerCase().replace(" ", ".")}@test.com`,
        phone: `+1555${String(5000 + i).padStart(7, "0")}`,
        defaultAddress: `${1000 + i} ${zone.name}, Manhattan, NY`,
        defaultLocation: {
          lat: zone.lat + (Math.random() - 0.5) * 0.002,
          lng: zone.lng + (Math.random() - 0.5) * 0.002,
        },
      });
      customers.push(customer);
    }
    console.log(`✓ Created ${customers.length} customers\n`);

    // Create 3 drivers with capacity of 3 each
    console.log("🚗 Creating 3 drivers (3 orders capacity each)...\n");
    const driverNames = [
      "Multi-Pickup Driver 1",
      "Multi-Pickup Driver 2",
      "Multi-Pickup Driver 3",
    ];

    let totalCapacity = 0;
    for (let i = 0; i < driverNames.length; i++) {
      // Start drivers near pickup zones
      const location = i % 2 === 0 ? PICKUP_ZONE_WEST : PICKUP_ZONE_EAST;

      const driver = await driverService.createDriver({
        name: driverNames[i],
        phone: `+1555${String(6000 + i).padStart(7, "0")}`,
        vehicleType: "car",
        maxOrders: 3, // Each can handle 3 orders
        initialLocation: {
          lat: location.lat + (Math.random() - 0.5) * 0.002,
          lng: location.lng + (Math.random() - 0.5) * 0.002,
        },
      });

      const driverRepo = AppDataSource.getRepository("Driver");
      driver.status = DriverStatus.AVAILABLE;
      await driverRepo.save(driver);

      totalCapacity += 3;
      console.log(`  ✓ ${driverNames[i].padEnd(25)} | Near ${location.name}`);
    }
    console.log(`\n  📊 Total capacity: ${totalCapacity} orders\n`);

    // Create 9 orders with clustered pickups and deliveries
    console.log(
      "📦 Creating 9 orders (clustered for multi-pickup optimization)...\n"
    );

    const orderConfigs = [
      // Group 1: West pickups -> North deliveries (ideal for Driver 1)
      {
        pickup: PICKUP_ZONE_WEST,
        delivery: DELIVERY_ZONE_NORTH,
        group: "West->North",
      },
      {
        pickup: PICKUP_ZONE_WEST,
        delivery: DELIVERY_ZONE_NORTH,
        group: "West->North",
      },
      {
        pickup: PICKUP_ZONE_WEST,
        delivery: DELIVERY_ZONE_NORTH,
        group: "West->North",
      },

      // Group 2: East pickups -> South deliveries (ideal for Driver 2)
      {
        pickup: PICKUP_ZONE_EAST,
        delivery: DELIVERY_ZONE_SOUTH,
        group: "East->South",
      },
      {
        pickup: PICKUP_ZONE_EAST,
        delivery: DELIVERY_ZONE_SOUTH,
        group: "East->South",
      },
      {
        pickup: PICKUP_ZONE_EAST,
        delivery: DELIVERY_ZONE_SOUTH,
        group: "East->South",
      },

      // Group 3: Mixed (for Driver 3)
      {
        pickup: PICKUP_ZONE_WEST,
        delivery: DELIVERY_ZONE_SOUTH,
        group: "West->South",
      },
      {
        pickup: PICKUP_ZONE_EAST,
        delivery: DELIVERY_ZONE_NORTH,
        group: "East->North",
      },
      {
        pickup: PICKUP_ZONE_WEST,
        delivery: DELIVERY_ZONE_NORTH,
        group: "West->North",
      },
    ];

    for (let i = 0; i < orderConfigs.length; i++) {
      const config = orderConfigs[i];
      const deliveryDate = new Date();
      deliveryDate.setHours(deliveryDate.getHours() + 3);

      const order = await orderService.createOrder({
        pickupLat: config.pickup.lat + (Math.random() - 0.5) * 0.001, // Very close clustering
        pickupLng: config.pickup.lng + (Math.random() - 0.5) * 0.001,
        pickupAddress: `${1100 + i} ${config.pickup.name}, Manhattan, NY`,
        dropoffLat: config.delivery.lat + (Math.random() - 0.5) * 0.001,
        dropoffLng: config.delivery.lng + (Math.random() - 0.5) * 0.001,
        dropoffAddress: `${1200 + i} ${config.delivery.name}, Manhattan, NY`,
        requestedDeliveryDate: deliveryDate,
        preferredTimeSlot: "morning",
        priority: 5,
        customerId: customers[i % customers.length].id,
      });

      const orderRepo = AppDataSource.getRepository("Order");
      order.status = OrderStatus.PENDING;
      await orderRepo.save(order);

      console.log(`  ✓ Order ${i + 1}: ${config.group}`);
    }

    console.log(
      "\n═══════════════════════════════════════════════════════════"
    );
    console.log("✓ Test case seeding completed!");
    console.log(
      "═══════════════════════════════════════════════════════════\n"
    );
    console.log("📊 Test Setup:");
    console.log("   • 3 drivers × 3 capacity = 9 total capacity");
    console.log("   • 9 orders with clustered pickups and deliveries");
    console.log("   • Pickup zones: Chelsea (West), East Village (East)");
    console.log(
      "   • Delivery zones: Upper West (North), Financial District (South)"
    );
    console.log("\n🧪 Expected Routing Patterns:");
    console.log(
      "   • Driver 1: P1(West) -> P2(West) -> P3(West) -> D1(North) -> D2(North) -> D3(North)"
    );
    console.log(
      "   • Driver 2: P4(East) -> P5(East) -> P6(East) -> D4(South) -> D5(South) -> D6(South)"
    );
    console.log("   • Driver 3: Mixed pattern with remaining orders");
    console.log("\n💡 Efficiency Test:");
    console.log("   • Multi-pickup pattern should be ~30-40% more efficient");
    console.log("   • Compare to alternating P-D-P-D-P-D pattern");
    console.log("   • Check route sequences in assignment results\n");
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
