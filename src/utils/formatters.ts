/**
 * Formatting utilities for human-readable time and distance
 */

/**
 * Format distance in meters to human-readable string
 * @param meters Distance in meters
 * @returns Formatted string (e.g., "1.5 km", "850 m")
 */
export function formatDistance(meters: number): string {
  if (meters < 0) return "0 m";

  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km.toFixed(1)} km`;
  }

  return `${Math.round(meters)} m`;
}

/**
 * Format duration in seconds to human-readable string
 * @param seconds Duration in seconds
 * @returns Formatted string (e.g., "1h 30m", "45 min", "30 sec")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "0 sec";

  if (seconds < 60) {
    return `${Math.round(seconds)} sec`;
  }

  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

/**
 * Format a Date to readable time string (e.g., "2:30 PM")
 * @param date Date object
 * @returns Formatted time string
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format a Date to readable date string (e.g., "Jan 15, 2024")
 * @param date Date object
 * @returns Formatted date string
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a Date to full readable datetime string (e.g., "Jan 15, 2024 at 2:30 PM")
 * @param date Date object
 * @returns Formatted datetime string
 */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} at ${formatTime(date)}`;
}

/**
 * Format a time window range (e.g., "2:00 PM - 2:30 PM")
 * @param start Start time
 * @param end End time
 * @returns Formatted time window string
 */
export function formatTimeWindow(start: Date, end: Date): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/**
 * Format ETA with relative time (e.g., "2:30 PM (in 15 min)")
 * @param eta Estimated time of arrival
 * @param from Reference time (defaults to now)
 * @returns Formatted ETA string
 */
export function formatETA(eta: Date, from: Date = new Date()): string {
  const diffSeconds = Math.max(0, (eta.getTime() - from.getTime()) / 1000);
  const timeStr = formatTime(eta);
  const durationStr = formatDuration(diffSeconds);

  return `${timeStr} (in ${durationStr})`;
}

/**
 * Format distance and duration together (e.g., "2.5 km • 12 min")
 * @param distanceMeters Distance in meters
 * @param durationSeconds Duration in seconds
 * @returns Combined formatted string
 */
export function formatRoute(
  distanceMeters: number,
  durationSeconds: number
): string {
  return `${formatDistance(distanceMeters)} • ${formatDuration(durationSeconds)}`;
}
