// Get the API base URL based on environment
export const getApiUrl = (): string => {
  // If in development (localhost)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  
  // Production: Use your deployed Render backend URL
  // Replace with your actual Render URL
  return 'https://overdrive-8lvv.onrender.com/';
};

export const API_URL = getApiUrl();
