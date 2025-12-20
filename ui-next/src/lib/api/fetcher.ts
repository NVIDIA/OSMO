/**
 * Custom fetcher for orval-generated API client.
 * Handles authentication and error responses.
 */
export const customFetch = async <T>(
  url: string,
  options?: RequestInit
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
};
