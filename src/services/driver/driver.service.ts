import { AppDataSource } from '../../config/ormconfig';
import { Driver } from '../../entities/Driver';
import { DriverLocation } from '../../entities/DriverLocation';
import { OrderAssignment } from '../../entities/OrderAssignment';
import { DriverStatus } from '../../enums/DriverStatus';
import { Location } from '../../interfaces/Location';
import { DriverWithDistance } from '../../interfaces/Driver';
import { findDriversWithinRadius } from '../../services/geospatial/queries';

export interface CreateDriverDTO {
  name: string;
  phone: string;
  vehicleType: string;
  maxOrders?: number;
  initialLocation?: Location;
}

export interface UpdateDriverLocationDTO {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
}

export class DriverService {
  private driverRepo = AppDataSource.getRepository(Driver);
  private locationRepo = AppDataSource.getRepository(DriverLocation);
  private assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  /**
   * Create a new driver
   */
  async createDriver(data: CreateDriverDTO): Promise<Driver> {
    const driver = this.driverRepo.create({
      name: data.name,
      phone: data.phone,
      vehicleType: data.vehicleType,
      maxOrders: data.maxOrders || 3,
      status: DriverStatus.OFFLINE,
    });

    const savedDriver = await this.driverRepo.save(driver);

    // Set initial location if provided
    if (data.initialLocation) {
      await this.updateDriverLocation(savedDriver.id, {
        lat: data.initialLocation.lat,
        lng: data.initialLocation.lng,
      });
    }

    return savedDriver;
  }

  /**
   * Get driver by ID
   */
  async getDriver(id: string): Promise<Driver | null> {
    return await this.driverRepo.findOne({
      where: { id },
      relations: ['assignments'],
    });
  }

  /**
   * Update driver location
   */
  async updateDriverLocation(
    driverId: string,
    locationData: UpdateDriverLocationDTO
  ): Promise<DriverLocation> {
    // Verify driver exists
    const driver = await this.driverRepo.findOne({ where: { id: driverId } });
    if (!driver) {
      throw new Error('Driver not found');
    }

    const location = this.locationRepo.create({
      driverId,
      location: {
        type: 'Point',
        coordinates: [locationData.lng, locationData.lat], // GeoJSON order: [lng, lat]
      },
      heading: locationData.heading,
      speed: locationData.speed,
      timestamp: new Date(),
    });

    return await this.locationRepo.save(location);
  }

  /**
   * Update driver status
   */
  async updateDriverStatus(driverId: string, status: DriverStatus): Promise<Driver> {
    const driver = await this.driverRepo.findOne({ where: { id: driverId } });
    if (!driver) {
      throw new Error('Driver not found');
    }

    driver.status = status;
    return await this.driverRepo.save(driver);
  }

  /**
   * Get available drivers within radius of a location
   */
  async getAvailableDriversNearLocation(
    location: Location,
    radiusMeters: number = 5000
  ): Promise<DriverWithDistance[]> {
    return await findDriversWithinRadius(location, radiusMeters, {
      status: [DriverStatus.AVAILABLE],
      limit: 50,
    });
  }

  /**
   * Get count of active orders for a driver
   */
  async getDriverActiveOrderCount(driverId: string): Promise<number> {
    const count = await this.assignmentRepo
      .createQueryBuilder('assignment')
      .innerJoin('assignment.order', 'order')
      .where('assignment.driverId = :driverId', { driverId })
      .andWhere('order.status NOT IN (:...statuses)', {
        statuses: ['delivered', 'cancelled'],
      })
      .getCount();

    return count;
  }

  /**
   * Check if driver can accept more orders
   */
  async canAcceptOrder(driverId: string): Promise<boolean> {
    const driver = await this.getDriver(driverId);
    if (!driver) {
      return false;
    }

    if (driver.status !== DriverStatus.AVAILABLE) {
      return false;
    }

    const activeOrderCount = await this.getDriverActiveOrderCount(driverId);
    return activeOrderCount < driver.maxOrders;
  }

  /**
   * Get all drivers (for admin/testing purposes)
   */
  async getAllDrivers(): Promise<Driver[]> {
    return await this.driverRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Delete a driver
   */
  async deleteDriver(driverId: string): Promise<boolean> {
    const result = await this.driverRepo.delete(driverId);
    return result.affected ? result.affected > 0 : false;
  }
}

// Export singleton instance
export const driverService = new DriverService();
