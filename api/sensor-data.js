/**
 * API Endpoint: POST /api/sensor-data
 * 
 * This is a Vercel Serverless Function that receives sensor data
 * from the ESP32 via HTTP POST request.
 * 
 * The ESP32 sends:
 *   { voltage, current, temperature, humidity }
 * 
 * This function:
 *   1. Validates the incoming data
 *   2. Calculates power (V × I)
 *   3. Stores data in Supabase sensor_data table
 *   4. Updates energy usage (energy_used, energy_remaining)
 *   5. Checks for alerts and triggers auto-shutoff if needed
 *   6. Returns success/error response
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client (server-side, uses service role key for full access)
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Alert thresholds (must match frontend alertSystem.js)
const THRESHOLDS = {
  VOLTAGE_MIN: 50,
  CURRENT_FAULT: 25,
  POWER_FAULT: 5000,
  TEMP_FAULT: 70,
};

export default async function handler(req, res) {
  // CORS headers (allow ESP32 and any origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Validate Supabase config
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server configuration error: Supabase credentials missing' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Parse and validate request body
    const { voltage, current, temperature, humidity } = req.body;

    if (voltage === undefined || current === undefined ||
        temperature === undefined || humidity === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['voltage', 'current', 'temperature', 'humidity'],
        example: { voltage: 220.5, current: 2.3, temperature: 28.5, humidity: 55.0 }
      });
    }

    // Validate types
    const v = parseFloat(voltage);
    const i = parseFloat(current);
    const t = parseFloat(temperature);
    const h = parseFloat(humidity);

    if (isNaN(v) || isNaN(i) || isNaN(t) || isNaN(h)) {
      return res.status(400).json({ error: 'All values must be valid numbers' });
    }

    // Calculate power
    const power = v * i;

    // 1. Insert sensor data
    const { data: sensorData, error: sensorError } = await supabase
      .from('sensor_data')
      .insert({
        voltage: v,
        current: i,
        temperature: t,
        humidity: h,
        power: power,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (sensorError) {
      console.error('Sensor data insert error:', sensorError);
      return res.status(500).json({ error: 'Failed to store sensor data', details: sensorError.message });
    }

    // 2. Update energy usage
    // Assuming each data point represents ~3 seconds of measurement
    const energyIncrementKwh = (power * 3) / 3600000; // Convert W·s to kWh

    const { data: energyData } = await supabase
      .from('user_energy')
      .select('*')
      .eq('id', 1)
      .single();

    if (energyData) {
      const newEnergyUsed = energyData.energy_used + energyIncrementKwh;
      const newEnergyRemaining = energyData.total_energy_bought - newEnergyUsed;

      await supabase
        .from('user_energy')
        .update({
          energy_used: newEnergyUsed,
          energy_remaining: Math.max(0, newEnergyRemaining)
        })
        .eq('id', 1);
    }

    // 3. Check for fault conditions and create alerts
    const alerts = [];
    let shouldShutoff = false;

    if (v < THRESHOLDS.VOLTAGE_MIN && v >= 0) {
      alerts.push({ type: 'power_loss', message: `Power loss detected! Voltage: ${v.toFixed(1)}V` });
    }

    if (i > THRESHOLDS.CURRENT_FAULT) {
      alerts.push({ type: 'faulty', message: `FAULT: Current ${i.toFixed(2)}A exceeds limit. Auto-shutoff!` });
      shouldShutoff = true;
    }

    if (power > THRESHOLDS.POWER_FAULT) {
      alerts.push({ type: 'faulty', message: `FAULT: Power ${power.toFixed(0)}W exceeds limit. Auto-shutoff!` });
      shouldShutoff = true;
    }

    if (t > THRESHOLDS.TEMP_FAULT) {
      alerts.push({ type: 'faulty', message: `FAULT: Temperature ${t.toFixed(1)}°C critical. Auto-shutoff!` });
      shouldShutoff = true;
    }

    // Store alerts in database
    if (alerts.length > 0) {
      await supabase
        .from('alerts')
        .insert(alerts.map(a => ({
          type: a.type,
          message: a.message,
          created_at: new Date().toISOString()
        })));
    }

    // 4. Auto-shutoff relay if fault detected
    if (shouldShutoff) {
      await supabase
        .from('control')
        .update({ relay_status: false, updated_at: new Date().toISOString() })
        .eq('id', 1);
    }

    // 5. Return response
    return res.status(200).json({
      success: true,
      data: {
        id: sensorData.id,
        voltage: v,
        current: i,
        power: power,
        temperature: t,
        humidity: h,
        timestamp: sensorData.created_at
      },
      alerts: alerts.length > 0 ? alerts : undefined,
      relayShutoff: shouldShutoff || undefined
    });

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
