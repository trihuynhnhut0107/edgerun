export enum AssignmentStatus {
  OFFERED = 'offered',     // Draft selected, waiting for driver response
  ACCEPTED = 'accepted',   // Driver accepted
  REJECTED = 'rejected',   // Driver rejected
  EXPIRED = 'expired',     // Offer timeout (treated as rejection)
  COMPLETED = 'completed', // Delivery finished
  CANCELLED = 'cancelled', // Order cancelled
}
