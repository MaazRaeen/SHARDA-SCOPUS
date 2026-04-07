import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Enable zone change detection for better performance
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Provide routing
    provideRouter(routes),
    // Provide HTTP client with fetch API support
    provideHttpClient(withFetch())
    // Note: provideClientHydration() removed - SSR not configured
  ]
};

