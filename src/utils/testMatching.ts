/**
 * Test Matching Engine with Sample Data
 * Creates test orders and drivers, then runs the divide-and-conquer algorithm
 *
 * Usage: ts-node src/utils/testMatching.ts
 */

import 'reflect-metadata';
import { AppDataSource } from '../config/ormconfig';
import { matchOrders } from '../services/matching/matchingEngine';
import { setupTestDatabase, cleanupTestDatabase } from './testDatabaseSetup';

/**
 * Main test function
 */
async function runMatchingTest() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 MATCHING ENGINE TEST - Week 1 MVP');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Initialize database
    console.log('📍 Initializing database connection...');
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    console.log('✅ Database connected\n');

    // Setup test data using testDatabaseSetup utility
    console.log('🧹 Cleaning up previous test data...');
    console.log('📦 Generating test data...');
    console.log('💾 Saving test orders and drivers to database...');

    const { orders: testOrders, drivers: testDrivers } = await setupTestDatabase(15, 5);

    console.log(`✅ Created and saved ${testOrders.length} test orders and ${testDrivers.length} test drivers\n`);

    // Run matching engine
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 RUNNING DIVIDE-AND-CONQUER MATCHING ENGINE');
    console.log('═══════════════════════════════════════════════════════════\n');

    const startTime = Date.now();
    const optimizedRoutes = await matchOrders();
    const elapsed = Date.now() - startTime;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 TEST RESULTS');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Print detailed results
    let totalDistance = 0;
    let totalOrders = 0;

    for (const route of optimizedRoutes) {
      console.log(`\n📍 Route for ${route.driverName}:`);
      console.log(`   Orders: ${route.metrics.orderCount}`);
      console.log(`   Total Distance: ${(route.totalDistance / 1000).toFixed(2)} km`);
      console.log(`   Avg Distance/Order: ${(route.metrics.distancePerOrder / 1000).toFixed(2)} km`);
      console.log(`   Route Sequence: ${route.sequence.length} waypoints`);

      totalDistance += route.totalDistance;
      totalOrders += route.metrics.orderCount;
    }

    console.log('\n───────────────────────────────────────────────────────────');
    console.log('📊 AGGREGATE METRICS:');
    console.log(`   Total Routes Generated: ${optimizedRoutes.length}`);
    console.log(`   Total Orders Assigned: ${totalOrders} / ${testOrders.length}`);
    console.log(`   Total Distance: ${(totalDistance / 1000).toFixed(2)} km`);
    console.log(`   Avg Distance/Order: ${(totalDistance / totalOrders / 1000).toFixed(2)} km`);
    console.log(`   Computation Time: ${elapsed}ms`);
    console.log(`   Workload Balance: ${(totalOrders / optimizedRoutes.length).toFixed(1)} avg orders/driver`);

    // Success criteria
    console.log('\n───────────────────────────────────────────────────────────');
    console.log('✅ SUCCESS CRITERIA:');
    const criteria = [
      {
        name: 'All orders assigned',
        pass: totalOrders === testOrders.length,
      },
      {
        name: 'Routes are not empty',
        pass: optimizedRoutes.every((r) => r.metrics.orderCount > 0),
      },
      {
        name: 'Computation < 1 second',
        pass: elapsed < 1000,
      },
      {
        name: 'Valid workload balance',
        pass: optimizedRoutes.length > 0,
      },
    ];

    for (const item of criteria) {
      console.log(`   ${item.pass ? '✅' : '❌'} ${item.name}`);
    }

    const allPassed = criteria.every((c) => c.pass);
    console.log(`\n${allPassed ? '🎉 ALL TESTS PASSED!' : '⚠️  Some tests failed'}`);

    console.log('\n═══════════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  } finally {
    // Close database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

// Run the test
runMatchingTest().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
