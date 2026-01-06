import { Location } from './Location';
import { DriverStatus } from '../enums/DriverStatus';

export interface DriverWithLocation {
  id: string;
  name: string;
  phone: string;
  location: Location;
  status: DriverStatus;
  vehicleType: string;
  maxOrders: number;
  activeOrders: number;
  updatedAt: Date;
}

export interface DriverWithDistance extends DriverWithLocation {
  distance: number; // meters
}

export interface DriverLocationUpdate {
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
}
