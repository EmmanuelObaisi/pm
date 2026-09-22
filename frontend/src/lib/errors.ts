/**
 * What to show the user when a request is rejected. `ApiError` carries the
 * detail the backend sent; anything else falls back to the caller's wording.
 */
export const errorMessage = (caught: unknown, fallback: string): string =>
  caught instanceof Error ? caught.message : fallback;
