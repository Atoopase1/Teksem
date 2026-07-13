/**
 * Alert System Module (Vanilla JS)
 * Handles threshold detection, alert creation, and auto-shutoff logic.
 * 
 * Thresholds are configurable and can be adjusted based on your setup:
 *  - VOLTAGE_MIN: Minimum expected voltage (below = power loss)
 *  - CURRENT_WARNING: Current threshold for warnings
 *  - CURRENT_FAULT: Current threshold for fault/auto-shutoff
 *  - POWER_WARNING: Power threshold for warnings
 *  - POWER_FAULT: Power threshold for fault/auto-shutoff
 *  - ENERGY_LOW_PERCENT: Remaining energy percentage for low power alert
 * 
 * Depends on: window.AppSupabase
 */

(function () {
  'use strict';

  // --- Alert Thresholds (configurable) ---
  var THRESHOLDS = {
    VOLTAGE_MIN: 207,        // Below this = FAULTY (Under-voltage)
    VOLTAGE_MAX: 253,        // Above this = FAULTY (Over-voltage)
    CURRENT_WARNING: 15,     // Current warning threshold (A)
    CURRENT_FAULT: 25,       // Current fault threshold (A) → auto shutoff
    POWER_WARNING: 3000,     // Power warning threshold (W)
    POWER_FAULT: 5000,       // Power fault threshold (W) → auto shutoff
    ENERGY_LOW_PERCENT: 10,  // Low energy remaining % alert
    TEMP_WARNING: 50,        // Temperature warning (°C)
    TEMP_FAULT: 70           // Temperature fault (°C)
  };

  function updateLimits(power, current) {
    var supabase = window.AppSupabase.supabase;
    var isDemoMode = window.AppSupabase.isDemoMode;

    if (power !== null && !isNaN(power)) {
      THRESHOLDS.POWER_FAULT = parseFloat(power);
    }
    if (current !== null && !isNaN(current)) {
      THRESHOLDS.CURRENT_FAULT = parseFloat(current);
    }

    // Update in Database
    if (!isDemoMode) {
      return supabase
        .from('control')
        .update({
          power_limit: THRESHOLDS.POWER_FAULT,
          current_limit: THRESHOLDS.CURRENT_FAULT
        })
        .eq('id', 1)
        .then(function (result) {
          if (result.error) console.error('Error saving limits to Supabase:', result.error);
        })
        .catch(function (err) {
          console.error('Failed to sync limits to db:', err);
        });
    }
    return Promise.resolve();
  }

  /**
   * Analyze sensor data and generate alerts
   * @param {Object} data - { voltage, current, power, temperature, humidity }
   * @param {Object} energy - { energy_remaining, total_energy_bought }
   * @returns {Array} Array of alert objects
   */
  function analyzeData(data, energy) {
    var alerts = [];
    energy = energy || null;

    // --- Under Voltage Fault --- 
    if (data.voltage < THRESHOLDS.VOLTAGE_MIN) {
      alerts.push({
        type: 'faulty',
        message: 'CRITICAL: Under-voltage detected! ' + data.voltage.toFixed(1) + 'V is below safe limit (' + THRESHOLDS.VOLTAGE_MIN + 'V). Auto-shutoff activated!',
        severity: 'critical',
        autoShutoff: true
      });
    }

    // --- Over Voltage Fault ---
    if (data.voltage > THRESHOLDS.VOLTAGE_MAX) {
      alerts.push({
        type: 'faulty',
        message: 'CRITICAL: Over-voltage detected! ' + data.voltage.toFixed(1) + 'V exceeds safe limit (' + THRESHOLDS.VOLTAGE_MAX + 'V). Auto-shutoff activated!',
        severity: 'critical',
        autoShutoff: true
      });
    }

    // --- Current Fault (excessive) → Auto Shutoff ---
    if (data.current > THRESHOLDS.CURRENT_FAULT) {
      alerts.push({
        type: 'faulty',
        message: 'CRITICAL: Current ' + data.current.toFixed(2) + 'A exceeds fault limit (' + THRESHOLDS.CURRENT_FAULT + 'A). Auto-shutoff activated!',
        severity: 'critical',
        autoShutoff: true
      });
    }
    // --- Current Warning ---
    else if (data.current > THRESHOLDS.CURRENT_WARNING) {
      alerts.push({
        type: 'warning',
        message: 'High current detected: ' + data.current.toFixed(2) + 'A (threshold: ' + THRESHOLDS.CURRENT_WARNING + 'A)',
        severity: 'warning',
        autoShutoff: false
      });
    }

    // --- Power Fault → Auto Shutoff ---
    if (data.power > THRESHOLDS.POWER_FAULT) {
      alerts.push({
        type: 'faulty',
        message: 'CRITICAL: Power consumption ' + data.power.toFixed(0) + 'W exceeds fault limit (' + THRESHOLDS.POWER_FAULT + 'W). Auto-shutoff activated!',
        severity: 'critical',
        autoShutoff: true
      });
    }
    // --- Power Warning ---
    else if (data.power > THRESHOLDS.POWER_WARNING) {
      alerts.push({
        type: 'warning',
        message: 'High power consumption: ' + data.power.toFixed(0) + 'W (threshold: ' + THRESHOLDS.POWER_WARNING + 'W)',
        severity: 'warning',
        autoShutoff: false
      });
    }

    // --- Temperature Alerts ---
    if (data.temperature > THRESHOLDS.TEMP_FAULT) {
      alerts.push({
        type: 'faulty',
        message: 'CRITICAL: Temperature ' + data.temperature.toFixed(1) + '°C exceeds safe limit. Auto-shutoff activated!',
        severity: 'critical',
        autoShutoff: true
      });
    } else if (data.temperature > THRESHOLDS.TEMP_WARNING) {
      alerts.push({
        type: 'warning',
        message: 'High temperature: ' + data.temperature.toFixed(1) + '°C (threshold: ' + THRESHOLDS.TEMP_WARNING + '°C)',
        severity: 'warning',
        autoShutoff: false
      });
    }

    // --- Low Energy Alert ---
    if (energy && energy.total_energy_bought > 0) {
      var remainingPercent = (energy.energy_remaining / energy.total_energy_bought) * 100;
      if (remainingPercent <= THRESHOLDS.ENERGY_LOW_PERCENT && remainingPercent > 0) {
        alerts.push({
          type: 'warning',
          message: 'Low energy balance: ' + energy.energy_remaining.toFixed(2) + ' kWh remaining (' + remainingPercent.toFixed(1) + '%)',
          severity: 'warning',
          autoShutoff: false
        });
      } else if (energy.energy_remaining <= 0) {
        alerts.push({
          type: 'faulty',
          message: 'Energy balance depleted! Auto-shutoff activated.',
          severity: 'critical',
          autoShutoff: true
        });
      }
    }

    return alerts;
  }

  /**
   * Save alert to Supabase database
   * @param {Object} alert - { type, message }
   */
  function saveAlert(alert) {
    var supabase = window.AppSupabase.supabase;
    var isDemoMode = window.AppSupabase.isDemoMode;

    if (isDemoMode) return Promise.resolve();

    return supabase
      .from('alerts')
      .insert({
        type: alert.type,
        message: alert.message,
        created_at: new Date().toISOString()
      })
      .then(function (result) {
        if (result.error) console.error('Error saving alert:', result.error);
      })
      .catch(function (err) {
        console.error('Failed to save alert:', err);
      });
  }

  /**
   * Permanently delete all alerts from the database
   */
  function clearAllAlerts() {
    var supabase = window.AppSupabase.supabase;
    var isDemoMode = window.AppSupabase.isDemoMode;

    if (isDemoMode) return Promise.resolve();

    return supabase
      .from('alerts')
      .delete()
      .neq('id', 0) // Hack to delete all rows since delete() requires a filter
      .then(function (result) {
        if (result.error) console.error('Error clearing alerts:', result.error);
      })
      .catch(function (err) {
        console.error('Failed to clear alerts:', err);
      });
  }

  /**
   * Auto-shutoff relay when fault is detected
   */
  function autoShutoffRelay() {
    var supabase = window.AppSupabase.supabase;
    var isDemoMode = window.AppSupabase.isDemoMode;

    if (isDemoMode) return Promise.resolve();

    return supabase
      .from('control')
      .update({ relay_status: false, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .then(function (result) {
        if (result.error) console.error('Error shutting off relay:', result.error);
      })
      .catch(function (err) {
        console.error('Failed to auto-shutoff relay:', err);
      });
  }

  /**
   * Get overall system status based on alerts
   * @param {Array} alerts - Array of current alerts
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
    THRESHOLDS: THRESHOLDS,
    analyzeData: analyzeData,
    saveAlert: saveAlert,
    clearAllAlerts: clearAllAlerts,
    autoShutoffRelay: autoShutoffRelay,
    getSystemStatus: getSystemStatus,
    updateLimits: updateLimits
  };

})();
