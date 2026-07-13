/**
 * Supabase Client Configuration (Vanilla JS)
 * 
 * Replace these with your actual Supabase project credentials.
 * You can find them in: Supabase Dashboard → Settings → API
 * 
 * For Vercel deployment, set these as environment variables and
 * update the values below before deploying, or use a build script
 * to inject them.
 */

(function () {
  'use strict';

  // ============================================
  // SUPABASE CREDENTIALS
  // Replace these with your real values.
  // For Vercel, you can also inject them at build time.
  // ============================================
  var supabaseUrl = 'YOUR_SUPABASE_URL';
  var supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';

  // Validate configuration
  if (supabaseUrl === 'YOUR_SUPABASE_URL' || supabaseAnonKey === 'YOUR_SUPABASE_ANON_KEY') {
    console.warn(
      '⚠️ Supabase credentials not configured!\n' +
      'Edit js/supabase.js and set your credentials:\n' +
      '  supabaseUrl = "https://your-project.supabase.co"\n' +
      '  supabaseAnonKey = "your-anon-key"\n\n' +
      'Running in DEMO mode with simulated data.'
    );
  }

  // Check if we're in demo mode (no valid Supabase config)
  var isDemoMode = (supabaseUrl === 'YOUR_SUPABASE_URL' || supabaseAnonKey === 'YOUR_SUPABASE_ANON_KEY');

  // Create the Supabase client
  // Use a valid-looking placeholder URL in demo mode so createClient doesn't throw
  var safeUrl = isDemoMode ? 'https://placeholder.supabase.co' : supabaseUrl;
  var safeKey = isDemoMode ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder' : supabaseAnonKey;

  // supabase-js is loaded via CDN and exposes window.supabase
  var supabase = window.supabase.createClient(safeUrl, safeKey, {
    realtime: {
      params: {
        eventsPerSecond: 10   // Allow up to 10 events/sec for fast sensor data
      },
      heartbeatIntervalMs: 15000,    // Detect disconnects 2× faster (default 30s)
      reconnectAfterMs: function (tries) { // Aggressive exponential backoff
        var delays = [500, 1000, 2000, 5000]; // 0.5s → 1s → 2s → 5s cap
        return delays[Math.min(tries, delays.length - 1)];
      },
      timeout: 10000  // 10s timeout (fail fast, reconnect fast)
    }
  });

  // ============================================
  // EXPOSE GLOBALLY
  // ============================================
  window.AppSupabase = {
    supabase: supabase,
    isDemoMode: isDemoMode
  };

})();
