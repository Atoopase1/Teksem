/**
 * Alert System Module (Vanilla JS)
 * Handles threshold detection, alert creation, and auto-shutoff logic.
 *
 * Power/current limits set by the user are stored in localStorage and applied
 * locally — NO Supabase read/write is involved in the limit logic.
 *
 * Auto-shutoff sends an MQTT command directly to the ESP32 instead of
 * writing to the Supabase `control` table, keeping Supabase out of the
 * critical-control path.
 *
 * Thresholds:
 *  - VOLTAGE_MIN / VOLTAGE_MAX : safe voltage band
 *  - CURRENT_WARNING            : high-current warning
 *  - CURRENT_FAULT              : fault → auto shutoff
 *  - POWER_WARNING              : dynamically = POWER_FAULT × APPROACH_RATIO
 *  - POWER_FAULT                : user-set fault limit → auto shutoff
 *  - ENERGY_LOW_PERCENT         : % remaining for low-energy alert
 *  - TEMP_WARNING / TEMP_FAULT  : temperature thresholds
 *
 * Depends on: window.AppSupabase (for saveAlert / clearAllAlerts only)
 */

(function () {
  'use strict';

  // ── Persistence keys ────────────────────────────────────────────────
  var LS_POWER_LIMIT   = 'teksem_power_limit';
  var LS_CURRENT_LIMIT = 'teksem_current_limit';

  // ── How close to the fault limit triggers an "approaching" warning ──
  var APPROACH_RATIO = 0.85; // 85 % of POWER_FAULT / CURRENT_FAULT

  // --- Alert Thresholds (configurable) ---
  var THRESHOLDS = {
    VOLTAGE_MIN:        207,   // Below this = FAULTY (Under-voltage)
    VOLTAGE_MAX:        253,   // Above this = FAULTY (Over-voltage)
    CURRENT_WARNING:    15,    // Current warning threshold (A)
    CURRENT_FAULT:      25,    // Current fault threshold (A) → auto shutoff
    POWER_WARNING:      3000,  // Dynamically updated = POWER_FAULT × APPROACH_RATIO
    POWER_FAULT:        5000,  // Power fault threshold (W) → auto shutoff
    ENERGY_LOW_PERCENT: 10,    // Low energy remaining % alert
    TEMP_WARNING:       50,    // Temperature warning (°C)
    TEMP_FAULT:         70     // Temperature fault (°C)
  };

  // ── Restore persisted limits from localStorage ──────────────────────
  (function restoreLimits() {
    var storedPower   = parseFloat(localStorage.getItem(LS_POWER_LIMIT));
    var storedCurrent = parseFloat(localStorage.getItem(LS_CURRENT_LIMIT));
    if (!isNaN(storedPower)   && storedPower   > 0) {
      THRESHOLDS.POWER_FAULT   = storedPower;
      THRESHOLDS.POWER_WARNING = Math.round(storedPower * APPROACH_RATIO);
    }
    if (!isNaN(storedCurrent) && storedCurrent > 0) {
      THRESHOLDS.CURRENT_FAULT   = storedCurrent;
      THRESHOLDS.CURRENT_WARNING = Math.round(storedCurrent * APPROACH_RATIO);
    }
  })();

  /**
   * Update user-set limits.
   * Saves to localStorage (primary) and optionally syncs to Supabase (secondary).
   * The APPROACH_RATIO warning thresholds are recalculated automatically.
   *
   * @param {number} power   - new POWER_FAULT value in watts
   * @param {number} current - new CURRENT_FAULT value in amps
   * @returns {Promise}
   */
  function updateLimits(power, current) {
    if (power !== null && !isNaN(power) && power > 0) {
      THRESHOLDS.POWER_FAULT   = parseFloat(power);
      THRESHOLDS.POWER_WARNING = Math.round(THRESHOLDS.POWER_FAULT * APPROACH_RATIO);
      localStorage.setItem(LS_POWER_LIMIT, THRESHOLDS.POWER_FAULT);
    }
    if (current !== null && !isNaN(current) && current > 0) {
      THRESHOLDS.CURRENT_FAULT   = parseFloat(current);
      THRESHOLDS.CURRENT_WARNING = Math.round(THRESHOLDS.CURRENT_FAULT * APPROACH_RATIO);
      localStorage.setItem(LS_CURRENT_LIMIT, THRESHOLDS.CURRENT_FAULT);
    }

    console.log(
      '⚙️ Limits updated → Power fault:', THRESHOLDS.POWER_FAULT + 'W',
      '| Power warning (approaching):', THRESHOLDS.POWER_WARNING + 'W',
      '| Current fault:', THRESHOLDS.CURRENT_FAULT + 'A',
      '| Current warning:', THRESHOLDS.CURRENT_WARNING + 'A'
    );

    // Best-effort Supabase sync (non-critical — app works without it)
    var isDemoMode = window.AppSupabase && window.AppSupabase.isDemoMode;
    var supabase   = window.AppSupabase && window.AppSupabase.supabase;

    if (!isDemoMode && supabase) {
      return supabase
        .from('control')
        .update({
          power_limit:   THRESHOLDS.POWER_FAULT,
          current_limit: THRESHOLDS.CURRENT_FAULT
        })
        .eq('id', 1)
        .then(function (result) {
          if (result.error) console.warn('Supabase limits sync failed (non-critical):', result.error);
        })
        .catch(function (err) {
          console.warn('Supabase limits sync error (non-critical):', err);
        });
    }
    return Promise.resolve();
  }

  /**
   * Analyze sensor data and generate alerts.
   *
   * ALWAYS checked (safety-critical, regardless of advanced mode):
   *   - Under/over voltage
   *   - Temperature fault/warning
   *
   * Only checked when Advanced Features is ON (window._advancedMode === true):
   *   - Power fault / approaching-limit warning
   *   - Current fault / approaching-limit warning
   *   - Energy depletion / low-energy warning
   *
   * @param {Object} data   - { voltage, current, power, temperature, humidity }
   * @param {Object|null} energy - { energy_remaining, total_energy_bought } or null
   * @returns {Array} Array of alert objects
   */
  function analyzeData(data, energy) {
    var alerts = [];
    var advOn  = (window._advancedMode === true);
    energy = energy || null;

    // --- Under-Voltage Fault (always active) ---
    if (data.voltage > 0 && data.voltage < THRESHOLDS.VOLTAGE_MIN) {
      alerts.push({
        type:        'faulty',
        message:     'CRITICAL: Under-voltage detected! ' + data.voltage.toFixed(1) +
                     'V is below safe limit (' + THRESHOLDS.VOLTAGE_MIN + 'V). Auto-shutoff activated!',
        severity:    'critical',
        autoShutoff: true
      });
    }

    // --- Over-Voltage Fault (always active) ---
    if (data.voltage > THRESHOLDS.VOLTAGE_MAX) {
      alerts.push({
        type:        'faulty',
        message:     'CRITICAL: Over-voltage detected! ' + data.voltage.toFixed(1) +
                     'V exceeds safe limit (' + THRESHOLDS.VOLTAGE_MAX + 'V). Auto-shutoff activated!',
        severity:    'critical',
        autoShutoff: true
      });
    }

    // --- Current Fault → Auto Shutoff (advanced) ---
    if (advOn) {
      if (data.current > THRESHOLDS.CURRENT_FAULT) {
        alerts.push({
          type:        'faulty',
          message:     'CRITICAL: Current ' + data.current.toFixed(2) + 'A exceeds fault limit (' +
                       THRESHOLDS.CURRENT_FAULT + 'A). Auto-shutoff activated!',
          severity:    'critical',
          autoShutoff: true
        });
      }
      // --- Current Approaching Limit ---
      else if (data.current > THRESHOLDS.CURRENT_WARNING) {
        var currentPct = Math.round((data.current / THRESHOLDS.CURRENT_FAULT) * 100);
        alerts.push({
          type:        'warning',
          message:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Current approaching limit: ' + data.current.toFixed(2) + 'A — ' +
                       currentPct + '% of your ' + THRESHOLDS.CURRENT_FAULT + 'A limit.',
          severity:    'warning',
          autoShutoff: false
        });
      }

      // --- Power Fault → Auto Shutoff (advanced) ---
      if (data.power > THRESHOLDS.POWER_FAULT) {
        alerts.push({
          type:        'faulty',
          message:     'CRITICAL: Power ' + data.power.toFixed(0) + 'W exceeded your set limit (' +
                       THRESHOLDS.POWER_FAULT + 'W). Auto-shutoff activated!',
          severity:    'critical',
          autoShutoff: true
        });
      }
      // --- Power Approaching Limit ---
      else if (data.power > THRESHOLDS.POWER_WARNING) {
        var powerPct = Math.round((data.power / THRESHOLDS.POWER_FAULT) * 100);
        alerts.push({
          type:        'warning',
          message:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Power approaching your limit: ' + data.power.toFixed(0) + 'W — ' +
                       powerPct + '% of your ' + THRESHOLDS.POWER_FAULT + 'W limit. Relay will shut off at limit!',
          severity:    'warning',
          autoShutoff: false
        });
      }
    }

    // --- Temperature Alerts (always active) ---
    if (data.temperature > THRESHOLDS.TEMP_FAULT) {
      alerts.push({
        type:        'faulty',
        message:     'CRITICAL: Temperature ' + data.temperature.toFixed(1) +
                     '°C exceeds safe limit. Auto-shutoff activated!',
        severity:    'critical',
        autoShutoff: true
      });
    } else if (data.temperature > THRESHOLDS.TEMP_WARNING) {
      alerts.push({
        type:        'warning',
        message:     'High temperature: ' + data.temperature.toFixed(1) +
                     '°C (threshold: ' + THRESHOLDS.TEMP_WARNING + '°C)',
        severity:    'warning',
        autoShutoff: false
      });
    }

    // --- Low Energy / Depletion Alerts (advanced only) ---
    if (advOn && energy && energy.total_energy_bought > 0) {
      var remainingPercent = (energy.energy_remaining / energy.total_energy_bought) * 100;
      if (remainingPercent <= THRESHOLDS.ENERGY_LOW_PERCENT && remainingPercent > 0) {
        alerts.push({
          type:        'warning',
          message:     'Low energy balance: ' + energy.energy_remaining.toFixed(2) +
                       ' kWh remaining (' + remainingPercent.toFixed(1) + '%)',
          severity:    'warning',
          autoShutoff: false
        });
      } else if (energy.energy_remaining <= 0) {
        alerts.push({
          type:        'faulty',
          message:     'Energy balance depleted! Auto-shutoff activated.',
          severity:    'critical',
          autoShutoff: true
        });
      }
    }

    return alerts;
  }

  /**
   * Save alert to Supabase database (best-effort, non-critical).
   * @param {Object} alert - { type, message }
   */
  function saveAlert(alert) {
    var isDemoMode = window.AppSupabase && window.AppSupabase.isDemoMode;
    var supabase   = window.AppSupabase && window.AppSupabase.supabase;

    if (isDemoMode || !supabase) return Promise.resolve();

    return supabase
      .from('alerts')
      .insert({
        type:       alert.type,
        message:    alert.message,
        created_at: new Date().toISOString()
      })
      .then(function (result) {
        if (result.error) console.warn('Alert save failed (non-critical):', result.error);
      })
      .catch(function (err) {
        console.warn('Failed to save alert (non-critical):', err);
      });
  }

  /**
   * Permanently delete all alerts from the database (best-effort).
   */
  function clearAllAlerts() {
    var isDemoMode = window.AppSupabase && window.AppSupabase.isDemoMode;
    var supabase   = window.AppSupabase && window.AppSupabase.supabase;

    if (isDemoMode || !supabase) return Promise.resolve();

    return supabase
      .from('alerts')
      .delete()
      .neq('id', 0)
      .then(function (result) {
        if (result.error) console.warn('Clearing alerts failed (non-critical):', result.error);
      })
      .catch(function (err) {
        console.warn('Failed to clear alerts (non-critical):', err);
      });
  }

  /**
   * Auto-shutoff relay when a fault is detected.
   *
   * PRIMARY  → Publishes an MQTT relay-off command directly to the ESP32
   *            (no Supabase dependency in the critical path).
   * FALLBACK → Best-effort Supabase update for logging / remote visibility.
   *
   * The global `window._mqttClient` reference is set by app.js after the
   * MQTT connection is established.
   */
  function autoShutoffRelay() {
    // ── PRIMARY: MQTT command ────────────────────────────────────────
    var mqttClient = window._mqttClient;
    if (mqttClient && mqttClient.connected) {
      var payload = JSON.stringify({ relay: false, reason: 'auto_shutoff_fault' });
      mqttClient.publish('teksem/relay/control', payload);
      console.warn('🚨 Auto-shutoff: MQTT relay-OFF command sent.');
    } else {
      console.warn('🚨 Auto-shutoff triggered but MQTT not connected — UI updated only.');
    }

    // ── FALLBACK: Supabase update (non-critical) ─────────────────────
    var isDemoMode = window.AppSupabase && window.AppSupabase.isDemoMode;
    var supabase   = window.AppSupabase && window.AppSupabase.supabase;

    if (isDemoMode || !supabase) return Promise.resolve();

    return supabase
      .from('control')
      .update({ relay_status: false, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .then(function (result) {
        if (result.error) console.warn('Supabase relay shutoff sync failed (non-critical):', result.error);
      })
      .catch(function (err) {
        console.warn('Supabase relay shutoff error (non-critical):', err);
      });
  }

  /**
   * Get overall system status based on alerts.
   * @param {Array} alerts
   * @returns {string} 'normal' | 'warning' | 'fault'
   */
  function getSystemStatus(alerts) {
    if (alerts.some(function (a) { return a.type === 'faulty' || a.severity === 'critical'; })) return 'fault';
    if (alerts.some(function (a) { return a.type === 'warning'; })) return 'warning';
    return 'normal';
  }

  // ============================================
  // EXPOSE GLOBALLY
  // ============================================
  window.AppAlerts = {
    THRESHOLDS:      THRESHOLDS,
    analyzeData:     analyzeData,
    saveAlert:       saveAlert,
    clearAllAlerts:  clearAllAlerts,
    autoShutoffRelay: autoShutoffRelay,
    getSystemStatus: getSystemStatus,
    updateLimits:    updateLimits
  };

})();
