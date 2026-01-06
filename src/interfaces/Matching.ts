export interface MatchingResult {
  driverId: string;
  orderId: string;
  estimatedPickupTime: number; // milliseconds
  estimatedDeliveryTime: number; // milliseconds
  distance: number; // meters
  score: number; // matching score
}
