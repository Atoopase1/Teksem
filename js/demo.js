/**
 * Demo Data Simulator (Vanilla JS)
 * Generates realistic sensor data when Supabase isn't configured.
 * This allows the UI to be fully functional for demonstration purposes.
 */

(function () {
  'use strict';

  // Simulated state
  var demoState = {
    voltage: 220,
    current: 2.5,
    temperature: 28,
    humidity: 55,
    relayOn: true,
    energyBought: 100,
    energyUsed: 23.5,
    tick: 0
  };

  /**
   * Generate a new data point with realistic fluctuations
   */
  function generateDemoData() {
    demoState.tick++;

    // Simulate realistic voltage fluctuations (215-235V range with occasional dips)
    var voltageDrift = Math.sin(demoState.tick * 0.1) * 5;
    var voltageNoise = (Math.random() - 0.5) * 4;
    demoState.voltage = Math.max(0, 220 + voltageDrift + voltageNoise);

    // Simulate current based on relay state (0 when off, 1-8A when on)
    if (demoState.relayOn) {
      var currentBase = 3 + Math.sin(demoState.tick * 0.05) * 1.5;
      var currentNoise = (Math.random() - 0.5) * 0.5;
      demoState.current = Math.max(0, currentBase + currentNoise);
    } else {
      demoState.current = Math.max(0, (Math.random() - 0.5) * 0.1);
    }

    // Simulate temperature (slow changes, 25-35°C)
    var tempDrift = Math.sin(demoState.tick * 0.02) * 3;
    var tempNoise = (Math.random() - 0.5) * 0.3;
    demoState.temperature = 28 + tempDrift + tempNoise;

    // Simulate humidity (40-70%)
    var humidDrift = Math.sin(demoState.tick * 0.015) * 10;
    var humidNoise = (Math.random() - 0.5) * 2;
    demoState.humidity = Math.min(100, Math.max(0, 55 + humidDrift + humidNoise));

    // Calculate power
    var power = demoState.voltage * demoState.current;

    // Simulate energy consumption (power * time interval in hours)
    // Assuming 3-second intervals: 3/3600 hours
    if (demoState.relayOn) {
      demoState.energyUsed += (power * 3) / 3600000; // Convert W·s to kWh
    }

    return {
      voltage: parseFloat(demoState.voltage.toFixed(1)),
      current: parseFloat(demoState.current.toFixed(2)),
      temperature: parseFloat(demoState.temperature.toFixed(1)),
      humidity: parseFloat(demoState.humidity.toFixed(1)),
      power: parseFloat(power.toFixed(1))
    };
  }

  /**
   * Get current demo energy state
   */
  function getDemoEnergy() {
    return {
      total_energy_bought: demoState.energyBought,
      energy_used: parseFloat(demoState.energyUsed.toFixed(4)),
      energy_remaining: parseFloat((demoState.energyBought - demoState.energyUsed).toFixed(4))
    };
  }

  /**
   * Set relay state in demo mode
   */
  function setDemoRelay(on) {
    demoState.relayOn = on;
  }

  /**
   * Set energy bought in demo mode
   */
  function setDemoEnergyBought(kWh) {
    demoState.energyBought = kWh;
  }

  /**
   * Get relay state in demo mode
   */
  function getDemoRelay() {
    return demoState.relayOn;
  }

  /**
   * Trigger a simulated fault scenario for testing
   */
  function simulateFault(type) {
    switch (type) {
      case 'overcurrent':
        demoState.current = 28;
        break;
      case 'overvoltage':
        demoState.voltage = 280;
        break;
      case 'powerloss':
        demoState.voltage = 0;
        break;
      case 'overtemp':
        demoState.temperature = 75;
        break;
      default:
        // Reset to normal
        demoState.voltage = 220;
        demoState.current = 3;
        demoState.temperature = 28;
    }
  }

  // ============================================
  // EXPOSE GLOBALLY
  // ============================================
  window.AppDemo = {
    generateDemoData: generateDemoData,
    getDemoEnergy: getDemoEnergy,
    setDemoRelay: setDemoRelay,
    setDemoEnergyBought: setDemoEnergyBought,
    getDemoRelay: getDemoRelay,
    simulateFault: simulateFault,
    demoState: demoState
  };

})();
