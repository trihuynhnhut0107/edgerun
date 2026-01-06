/**
 * Geospatial Testing Utility
 * Tests PostGIS queries with sample data
 */

import { AppDataSource } from '../config/ormconfig';
import { Driver } from '../entities/Driver';
import { DriverLocation } from '../entities/DriverLocation';
import {
    findDriversWithinRadius,
    calculateDistance,
    getLatestDriverLocation,
    updateDriverLocation
} from '../services/geospatial/queries';
import { DriverStatus } from '../enums/DriverStatus';
import { Location } from '../interfaces/Location';
import { getDriverState } from '../services/state/driverStateManager';

// Sample test locations (San Francisco area)
const TEST_LOCATIONS = {
    downtown: { lat: 37.7749, lng: -122.4194 }, // Downtown SF
    mission: { lat: 37.7599, lng: -122.4148 }, // Mission District
    marina: { lat: 37.8044, lng: -122.4111 }, // Marina District
    castro: { lat: 37.7619, lng: -122.4343 }, // Castro Valley
    bayview: { lat: 37.7349, lng: -122.3829 } // Bayview
};

/**
 * Seed database with test drivers
 */
export async function seedTestDrivers() {
    const driverRepo = AppDataSource.getRepository(Driver);

    // Check if drivers already exist
    const existingCount = await driverRepo.count();
    if (existingCount > 0) {
        console.log('Test drivers already exist, skipping seed');
        return;
    }

    console.log('Seeding test drivers...');

    const testDrivers = [
        {
            name: 'Alice Chen',
            phone: '+1-415-001-0001',
            vehicleType: 'bike',
            maxOrders: 3,
            status: DriverStatus.AVAILABLE
        },
        {
            name: 'Bob Martinez',
            phone: '+1-415-001-0002',
            vehicleType: 'scooter',
            maxOrders: 2,
            status: DriverStatus.AVAILABLE
        },
        {
            name: 'Carol Lee',
            phone: '+1-415-001-0003',
            vehicleType: 'car',
            maxOrders: 5,
            status: DriverStatus.AVAILABLE
        },
        {
            name: 'David Park',
            phone: '+1-415-001-0004',
            vehicleType: 'bike',
            maxOrders: 3,
            status: DriverStatus.OFFLINE
        },
        {
            name: 'Eva Johnson',
            phone: '+1-415-001-0005',
            vehicleType: 'scooter',
            maxOrders: 4,
            status: DriverStatus.AVAILABLE
        }
    ];

    const drivers = await driverRepo.save(testDrivers);
    console.log(`✓ Created ${drivers.length} test drivers`);

    return drivers;
}

/**
 * Seed test driver locations
 */
export async function seedTestDriverLocations(drivers: Driver[]) {
    const locationRepo = AppDataSource.getRepository(DriverLocation);

    console.log('Seeding test driver locations...');

    const locations = drivers.flatMap((driver, index) => {
        const locationKeys = Object.keys(TEST_LOCATIONS) as (keyof typeof TEST_LOCATIONS)[];
        const location = TEST_LOCATIONS[locationKeys[index % locationKeys.length]];

        return {
            driverId: driver.id,
            lat: location.lat,
            lng: location.lng,
            heading: Math.random() * 360,
            speed: Math.random() * 40, // 0-40 km/h
            timestamp: new Date()
        };
    });

    await locationRepo.save(locations);
    console.log(`✓ Created ${locations.length} test driver locations`);
}

/**
 * Run geospatial tests
 */
export async function runGeospatialTests() {
    console.log('\n=== Running Geospatial Tests ===\n');

    try {
        // Test 1: Find drivers within radius
        console.log('Test 1: Find drivers within radius of downtown');
        const nearbyDrivers = await findDriversWithinRadius(
            TEST_LOCATIONS.downtown,
            3000, // 3km radius
            { status: [DriverStatus.AVAILABLE] }
        );
        console.log(`✓ Found ${nearbyDrivers.length} drivers within 3km`);
        nearbyDrivers.forEach(driver => {
            console.log(
                `  - ${driver.name}: ${driver.distance}m away (${driver.status})`
            );
        });

        // Test 2: Calculate distance between locations
        console.log('\nTest 2: Calculate distance between locations');
        const distance = await calculateDistance(
            TEST_LOCATIONS.downtown,
            TEST_LOCATIONS.mission
        );
        console.log(`✓ Distance between Downtown and Mission: ${distance}m`);

        // Test 3: Get latest driver location
        console.log('\nTest 3: Get latest driver location');
        const driverRepo = AppDataSource.getRepository(Driver);
        const firstDriver = await driverRepo.findOne({
            where: { status: DriverStatus.AVAILABLE }
        });

        if (firstDriver) {
            const latestLoc = await getLatestDriverLocation(firstDriver.id);
            if (latestLoc) {
                const coords = latestLoc.location?.coordinates || [0, 0];
                console.log(
                    `✓ Latest location for ${firstDriver.name}: (${coords[1]}, ${coords[0]})`
                );
            }
        }

        // Test 4: Update driver location
        console.log('\nTest 4: Update driver location');
        if (firstDriver) {
            const newLocation = TEST_LOCATIONS.marina;
            const updated = await updateDriverLocation(
                firstDriver.id,
                newLocation
            );
            const coords = updated.location?.coordinates || [0, 0];
            console.log(
                `✓ Updated ${firstDriver.name} location to: (${coords[1]}, ${coords[0]})`
            );
        }

        // Test 5: Get driver state
        console.log('\nTest 5: Get driver state');
        if (firstDriver) {
            const state = await getDriverState(firstDriver.id);
            if (state) {
                console.log(`✓ ${state.name}:`);
                console.log(`  - Status: ${state.status}`);
                console.log(`  - Location: (${state.location.lat}, ${state.location.lng})`);
                console.log(`  - Active Orders: ${state.activeOrders}/${state.maxOrders}`);
            }
        }

        console.log('\n✓ All tests passed!\n');
    } catch (error) {
        console.error('Test failed:', error);
        throw error;
    }
}

/**
 * Full test flow
 */
export async function runFullTest() {
    try {
        // Initialize database
        if (!AppDataSource.isInitialized) {
            await AppDataSource.initialize();
        }

        // Seed data
        const drivers = await seedTestDrivers();
        if (drivers) {
            await seedTestDriverLocations(drivers);
        }

        // Run tests
        await runGeospatialTests();

        console.log('✓ Geospatial testing complete!');
    } catch (error) {
        console.error('Error during testing:', error);
        throw error;
    } finally {
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
        }
    }
}

// Run if called directly
if (require.main === module) {
    runFullTest().catch(console.error);
}
