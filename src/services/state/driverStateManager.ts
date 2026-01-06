import { AppDataSource } from '../../config/ormconfig';
import { Driver } from '../../entities/Driver';
import { OrderAssignment } from '../../entities/OrderAssignment';
import { DriverStatus } from '../../enums/DriverStatus';
import { DriverWithLocation } from '../../interfaces/Driver';
import { Location } from '../../interfaces/Location';
import { getLatestDriverLocation, updateDriverLocation } from '../geospatial/queries';

/**
 * Driver State Manager
 * Manages driver status, active orders, and location tracking
 */

/**
 * Get driver with current state information
 */
export async function getDriverState(driverId: string): Promise<DriverWithLocation | null> {
    const driverRepo = AppDataSource.getRepository(Driver);
    const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

    // Get driver
    const driver = await driverRepo.findOne({
        where: { id: driverId }
    });

    if (!driver) {
        return null;
    }

    // Get latest location
    const latestLocation = await getLatestDriverLocation(driverId);

    // Count active orders
    const activeOrdersCount = await assignmentRepo.count({
        where: {
            driverId: driverId,
            actualDelivery: undefined // Not yet delivered
        }
    });

    // Extract lat/lng from PostGIS Point geometry (coordinates are [lng, lat])
    const coords = latestLocation?.location?.coordinates || [0, 0];

    return {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        status: driver.status as DriverStatus,
        maxOrders: driver.maxOrders,
        activeOrders: activeOrdersCount,
        location: {
            lat: coords[1], // latitude is second coordinate
            lng: coords[0]  // longitude is first coordinate
        },
        updatedAt: latestLocation?.timestamp || driver.updatedAt
    };
}

/**
 * Update driver status
 */
export async function updateDriverStatus(
    driverId: string,
    status: DriverStatus
): Promise<Driver> {
    const driverRepo = AppDataSource.getRepository(Driver);

    const driver = await driverRepo.findOne({
        where: { id: driverId }
    });

    if (!driver) {
        throw new Error(`Driver ${driverId} not found`);
    }

    driver.status = status;
    driver.updatedAt = new Date();

    return await driverRepo.save(driver);
}

/**
 * Update driver location and automatically manage status
 * - If status is OFFLINE and driver has location, change to AVAILABLE
 */
export async function updateDriverLocationAndStatus(
    driverId: string,
    location: Location,
    heading?: number,
    speed?: number
): Promise<DriverWithLocation> {
    // Update location in database
    await updateDriverLocation(driverId, location, heading, speed);

    // Get current driver state
    const driverState = await getDriverState(driverId);

    if (!driverState) {
        throw new Error(`Driver ${driverId} not found`);
    }

    // Auto-transition from OFFLINE to AVAILABLE if location is provided
    if (driverState.status === DriverStatus.OFFLINE) {
        await updateDriverStatus(driverId, DriverStatus.AVAILABLE);
        driverState.status = DriverStatus.AVAILABLE;
    }

    // Update location in returned state
    driverState.location = location;
    driverState.updatedAt = new Date();

    return driverState;
}

/**
 * Check if driver can accept a new order
 */
export async function canDriverAcceptOrder(driverId: string): Promise<boolean> {
    const driverState = await getDriverState(driverId);

    if (!driverState) {
        return false;
    }

    // Can accept if available and not at max orders
    return (
        driverState.status === DriverStatus.AVAILABLE &&
        driverState.activeOrders < driverState.maxOrders
    );
}

/**
 * Get all available drivers
 */
export async function getAvailableDrivers(): Promise<DriverWithLocation[]> {
    const driverRepo = AppDataSource.getRepository(Driver);
    const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

    // Get all drivers with status AVAILABLE
    const drivers = await driverRepo.find({
        where: { status: DriverStatus.AVAILABLE }
    });

    const result: DriverWithLocation[] = [];

    for (const driver of drivers) {
        // Check if driver can accept more orders
        const activeOrdersCount = await assignmentRepo.count({
            where: {
                driverId: driver.id,
                actualDelivery: undefined
            }
        });

        if (activeOrdersCount < driver.maxOrders) {
            const latestLocation = await getLatestDriverLocation(driver.id);

            // Extract lat/lng from PostGIS Point geometry
            const coords = latestLocation?.location?.coordinates || [0, 0];

            result.push({
                id: driver.id,
                name: driver.name,
                phone: driver.phone,
                vehicleType: driver.vehicleType,
                status: driver.status as DriverStatus,
                maxOrders: driver.maxOrders,
                activeOrders: activeOrdersCount,
                location: {
                    lat: coords[1], // latitude is second coordinate
                    lng: coords[0]  // longitude is first coordinate
                },
                updatedAt: latestLocation?.timestamp || driver.updatedAt
            });
        }
    }

    return result;
}

/**
 * Get drivers currently at capacity
 */
export async function getCapacityDrivers(): Promise<DriverWithLocation[]> {
    const driverRepo = AppDataSource.getRepository(Driver);
    const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

    const drivers = await driverRepo.find({
        where: { status: DriverStatus.AVAILABLE }
    });

    const result: DriverWithLocation[] = [];

    for (const driver of drivers) {
        const activeOrdersCount = await assignmentRepo.count({
            where: {
                driverId: driver.id,
                actualDelivery: undefined
            }
        });

        // At capacity if reached max orders
        if (activeOrdersCount >= driver.maxOrders) {
            const latestLocation = await getLatestDriverLocation(driver.id);

            // Extract lat/lng from PostGIS Point geometry
            const coords = latestLocation?.location?.coordinates || [0, 0];

            result.push({
                id: driver.id,
                name: driver.name,
                phone: driver.phone,
                vehicleType: driver.vehicleType,
                status: driver.status as DriverStatus,
                maxOrders: driver.maxOrders,
                activeOrders: activeOrdersCount,
                location: {
                    lat: coords[1], // latitude is second coordinate
                    lng: coords[0]  // longitude is first coordinate
                },
                updatedAt: latestLocation?.timestamp || driver.updatedAt
            });
        }
    }

    return result;
}

/**
 * Transition driver status through delivery workflow
 */
export async function transitionDriverStatus(
    driverId: string,
    nextStatus: DriverStatus
): Promise<Driver> {
    const currentDriver = await getDriverState(driverId);

    if (!currentDriver) {
        throw new Error(`Driver ${driverId} not found`);
    }

    // Validate status transitions
    const validTransitions: Record<DriverStatus, DriverStatus[]> = {
        [DriverStatus.OFFLINE]: [DriverStatus.AVAILABLE],
        [DriverStatus.AVAILABLE]: [DriverStatus.EN_ROUTE_PICKUP, DriverStatus.OFFLINE],
        [DriverStatus.EN_ROUTE_PICKUP]: [DriverStatus.AT_PICKUP],
        [DriverStatus.AT_PICKUP]: [DriverStatus.EN_ROUTE_DELIVERY],
        [DriverStatus.EN_ROUTE_DELIVERY]: [DriverStatus.AT_DELIVERY],
        [DriverStatus.AT_DELIVERY]: [DriverStatus.AVAILABLE, DriverStatus.OFFLINE]
    };

    const currentStatus = currentDriver.status as DriverStatus;
    const allowedTransitions = validTransitions[currentStatus] || [];

    if (!allowedTransitions.includes(nextStatus)) {
        throw new Error(
            `Invalid status transition from ${currentStatus} to ${nextStatus}`
        );
    }

    return await updateDriverStatus(driverId, nextStatus);
}

/**
 * Get driver utilization (percentage of time spent on deliveries)
 */
export async function getDriverUtilization(driverId: string): Promise<number> {
    const driverState = await getDriverState(driverId);

    if (!driverState) {
        throw new Error(`Driver ${driverId} not found`);
    }

    // Utilization = active orders / max orders
    return (driverState.activeOrders / driverState.maxOrders) * 100;
}
