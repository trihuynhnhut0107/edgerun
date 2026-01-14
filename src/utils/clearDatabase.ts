import "reflect-metadata";
import { AppDataSource } from "../config/ormconfig";
import { driverService } from "../services/driver/driver.service";

/**
 * Database Cleanup Utility
 * Removes all data from the database while respecting foreign key constraints.
 *
 * Usage: npm run database:clear
 */
const clearDatabase = async () => {
  try {
    console.log(
      "\n═══════════════════════════════════════════════════════════"
    );
    console.log("🧹 DATABASE CLEANUP");
    console.log(
      "═══════════════════════════════════════════════════════════\n"
    );

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("✓ Database connection established");
    }

    console.log(
      "Using `driverService.getAllDrivers()` to check for existence before clearing..."
    );
    const existingDrivers = await driverService.getAllDrivers();

    // We proceed to clear regardless, but it's good to know what we're clearing
    console.log(`Found ${existingDrivers.length} drivers currently in DB.`);

    const driverRepo = AppDataSource.getRepository("Driver");
    const orderRepo = AppDataSource.getRepository("Order");
    const customerRepo = AppDataSource.getRepository("Customer");
    const assignmentRepo = AppDataSource.getRepository("OrderAssignment");
    const locationRepo = AppDataSource.getRepository("DriverLocation");
    const timeWindowRepo = AppDataSource.getRepository("TimeWindow");
    const observationRepo = AppDataSource.getRepository(
      "RouteSegmentObservation"
    );
    const draftAssignmentRepo = AppDataSource.getRepository("DraftAssignment");
    const draftGroupRepo = AppDataSource.getRepository("DraftGroup");
    const distanceCacheRepo = AppDataSource.getRepository("DistanceCache");

    // Delete in order of foreign key dependencies
    console.log("Removing data...");

    // 1. TimeWindows (FK to assignments/orders)
    const timeWindows = await timeWindowRepo.find();
    if (timeWindows.length > 0) {
      await timeWindowRepo.remove(timeWindows);
      console.log(`  ✓ Removed ${timeWindows.length} time windows`);
    }

    // 2. DraftAssignments (FK to DraftGroup, Driver, Order)
    const draftAssignments = await draftAssignmentRepo.find();
    if (draftAssignments.length > 0) {
      await draftAssignmentRepo.remove(draftAssignments);
      console.log(`  ✓ Removed ${draftAssignments.length} draft assignments`);
    }

    // 3. DraftGroups (referenced by DraftAssignments)
    const draftGroups = await draftGroupRepo.find();
    if (draftGroups.length > 0) {
      await draftGroupRepo.remove(draftGroups);
      console.log(`  ✓ Removed ${draftGroups.length} draft groups`);
    }

    // 4. OrderAssignments (FK to Driver, Order)
    const assignments = await assignmentRepo.find();
    if (assignments.length > 0) {
      await assignmentRepo.remove(assignments);
      console.log(`  ✓ Removed ${assignments.length} order assignments`);
    }

    // 5. RouteSegmentObservations (FK to Driver)
    const observations = await observationRepo.find();
    if (observations.length > 0) {
      await observationRepo.remove(observations);
      console.log(`  ✓ Removed ${observations.length} route observations`);
    }

    // 6. DriverLocations (FK to Driver)
    const locations = await locationRepo.find();
    if (locations.length > 0) {
      await locationRepo.remove(locations);
      console.log(`  ✓ Removed ${locations.length} driver locations`);
    }

    // 7. DistanceCache (standalone, no FK)
    const distanceCaches = await distanceCacheRepo.find();
    if (distanceCaches.length > 0) {
      await distanceCacheRepo.remove(distanceCaches);
      console.log(`  ✓ Removed ${distanceCaches.length} distance cache entries`);
    }

    // 8. Orders (FK to Customer)
    const orders = await orderRepo.find();
    if (orders.length > 0) {
      await orderRepo.remove(orders);
      console.log(`  ✓ Removed ${orders.length} orders`);
    }

    // 9. Customers (referenced by Orders)
    const customers = await customerRepo.find();
    if (customers.length > 0) {
      await customerRepo.remove(customers);
      console.log(`  ✓ Removed ${customers.length} customers`);
    }

    // 10. Drivers (referenced by many entities)
    const drivers = await driverRepo.find();
    if (drivers.length > 0) {
      await driverRepo.remove(drivers);
      console.log(`  ✓ Removed ${drivers.length} drivers`);
    }

    console.log(
      "\n═══════════════════════════════════════════════════════════"
    );
    console.log("✓ Database cleared successfully!");
    console.log(
      "═══════════════════════════════════════════════════════════\n"
    );
  } catch (error) {
    console.error("\n✗ Database cleanup failed:", error);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
};

clearDatabase();
