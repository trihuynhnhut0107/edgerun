import { AppDataSource } from '../../config/ormconfig';
import { DriverStatus } from '../../enums/DriverStatus';
import { Location } from '../../interfaces/Location';
import { DriverWithDistance } from '../../interfaces/Driver';
import { Driver } from '../../entities/Driver';
import { DriverLocation } from '../../entities/DriverLocation';

/**
 * Find drivers within a radius of a given location
 * Uses PostGIS ST_DWithin for efficient geospatial queries
 */
export async function findDriversWithinRadius(
    center: Location,
    radiusMeters: number,
    filters?: {
        status?: DriverStatus[];
        limit?: number;
    }
): Promise<DriverWithDistance[]> {
    const limit = filters?.limit || 20;
    const hasStatusFilter = filters?.status && filters.status.length > 0;

    // Use raw query for PostGIS functionality
    const params = hasStatusFilter
        ? [center.lng, center.lat, radiusMeters, filters!.status]
        : [center.lng, center.lat, radiusMeters];

    const sqlQuery = `
        WITH latest_locations AS (
            SELECT DISTINCT ON ("driverId")
                "driverId",
                lat,
                lng,
                "timestamp"
            FROM driver_locations
            ORDER BY "driverId", "timestamp" DESC
        )
        SELECT
            d.id,
            d.name,
            d.phone,
            d."vehicleType",
            d."maxOrders",
            d.rating,
            d.status,
            ll.lat,
            ll.lng,
            ll."timestamp" as "updatedAt",
            ST_Distance(
                ST_MakePoint($1, $2)::geography,
                ST_MakePoint(ll.lng, ll.lat)::geography
            )::integer as distance
        FROM drivers d
        INNER JOIN latest_locations ll ON d.id = ll."driverId"
        WHERE ST_DWithin(
            ST_MakePoint($1, $2)::geography,
            ST_MakePoint(ll.lng, ll.lat)::geography,
            $3
        )
        ${hasStatusFilter ? `AND d.status = ANY($4)` : ''}
        ORDER BY distance ASC
        LIMIT ${limit}
    `;

    const results = await AppDataSource.manager.query(sqlQuery, params);

    return results.map((row: any) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        vehicleType: row.vehicleType,
        maxOrders: row.maxOrders,
        rating: row.rating,
        status: row.status as DriverStatus,
        location: {
            lat: row.lat,
            lng: row.lng
        },
        activeOrders: 0, // Will be calculated separately
        distance: row.distance,
        updatedAt: row.updatedAt
    }));
}

/**
 * Update driver location
 * Stores new location entry with timestamp
 */
export async function updateDriverLocation(
    driverId: string,
    location: Location,
    heading?: number,
    speed?: number
): Promise<DriverLocation> {
    const driverLocationRepo = AppDataSource.getRepository(DriverLocation);

    const newLocation = new DriverLocation();
    newLocation.driverId = driverId;
    newLocation.location = {
        type: 'Point',
        coordinates: [location.lng, location.lat], // GeoJSON order: [lng, lat]
    };
    newLocation.heading = heading || undefined;
    newLocation.speed = speed || undefined;
    newLocation.timestamp = new Date();

    return await driverLocationRepo.save(newLocation);
}

/**
 * Get the latest location for a specific driver
 */
export async function getLatestDriverLocation(driverId: string): Promise<DriverLocation | null> {
    const driverLocationRepo = AppDataSource.getRepository(DriverLocation);

    return await driverLocationRepo
        .createQueryBuilder('dl')
        .where('dl.driverId = :driverId', { driverId })
        .orderBy('dl.timestamp', 'DESC')
        .limit(1)
        .getOne();
}


/**
 * Calculate distance between two locations using PostGIS
 * Returns distance in meters
 */
export async function calculateDistance(
    from: Location,
    to: Location
): Promise<number> {
    const result = await AppDataSource.manager.query(`
        SELECT ST_Distance(
            ST_MakePoint($1, $2)::geography,
            ST_MakePoint($3, $4)::geography
        )::integer as distance
    `, [from.lng, from.lat, to.lng, to.lat]);

    return result[0].distance;
}