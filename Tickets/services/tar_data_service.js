/**
 * TAR Data Service
 * Handles data retrieval for Tech Activity Report
 * Supports both real API and dummy data (fallback)
 */

class TARDataService {
  constructor() {
    // Configuration: Set to true to use real API, false for dummy data
    this.USE_REAL_API = false;
    
    // API configuration - update these with your actual backend endpoints
    this.API_BASE_URL = '/api/tar'; // e.g., 'http://localhost:3000/api/tar'
    this.TIMEOUT = 5000; // milliseconds
  }

  /**
   * Fetch location data - switches between real API and dummy data
   * @param {string} location - Location name
   * @returns {Promise<Object>} Location data object
   */
  async getLocationData(location) {
    if (this.USE_REAL_API) {
      return this.fetchFromAPI(location);
    } else {
      return this.getFromDummyData(location);
    }
  }

  /**
   * Fetch data from real API
   * API should return structure matching tar_dummy_data.js format:
   * {
   *   location: string,
   *   startDate: string (YYYY-MM-DD),
   *   endDate: string (YYYY-MM-DD),
   *   activityByDate: { "6": { ASG, CMP, CAN, RRR, LDT }, ... },
   *   dailyData: [ { date, assigned, completed, cancelled, exchanged, pending, redo, ldt, mileage }, ... ],
   *   techData: [ { name, assigned, completed, cancelled, exchanged, pending, redo, ldt, mileage }, ... ],
   *   completedTickets: [ { workOrderNum, technician, date, status, mileage }, ... ]
   * }
   */
  async fetchFromAPI(location) {
    try {
      const response = await fetch(`${this.API_BASE_URL}/locations/${location}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          // Add authentication headers if needed:
          // 'Authorization': `Bearer ${token}`
        },
        timeout: this.TIMEOUT
      });

      if (!response.ok) {
        console.warn(`API returned ${response.status} for location ${location}, falling back to dummy data`);
        return this.getFromDummyData(location);
      }

      const data = await response.json();
      console.log(`✓ Real data loaded for ${location} from API`);
      return data;
    } catch (error) {
      console.warn(`API fetch failed for ${location}: ${error.message}, falling back to dummy data`);
      return this.getFromDummyData(location);
    }
  }

  /**
   * Get data from dummy data file (development fallback)
   */
  getFromDummyData(location) {
    if (!window.tarDummyData || !window.tarDummyData.locations[location]) {
      console.error(`Location '${location}' not found in dummy data`);
      return null;
    }
    return window.tarDummyData.locations[location];
  }

  /**
   * Get all available locations
   */
  getAvailableLocations() {
    if (this.USE_REAL_API) {
      // TODO: Fetch from API endpoint: GET /api/tar/locations
      console.log('TODO: Implement real API location list');
    }
    
    // Fallback to dummy data locations
    if (window.tarDummyData && window.tarDummyData.locations) {
      return Object.keys(window.tarDummyData.locations);
    }
    return [];
  }

  /**
   * Enable/disable real API (useful for testing and switching modes)
   */
  setUseRealAPI(enabled) {
    this.USE_REAL_API = enabled;
    console.log(`TAR Data Service: Real API ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Set API base URL
   */
  setAPIBaseURL(url) {
    this.API_BASE_URL = url;
    console.log(`TAR Data Service: API URL set to ${url}`);
  }

  /**
   * Health check - verify API is available
   */
  async checkAPIHealth() {
    try {
      const response = await fetch(`${this.API_BASE_URL}/health`, {
        method: 'GET',
        timeout: 2000
      });
      return response.ok;
    } catch (error) {
      console.warn(`API health check failed: ${error.message}`);
      return false;
    }
  }
}

// Create global instance
window.tarDataService = new TARDataService();

// Example usage in console:
// To switch to real API (once backend is ready):
//   tarDataService.setAPIBaseURL('http://your-api-url.com/api/tar');
//   tarDataService.setUseRealAPI(true);
//
// To check API health:
//   tarDataService.checkAPIHealth();
//
// To get location data:
//   tarDataService.getLocationData('Birmingham').then(data => console.log(data));
