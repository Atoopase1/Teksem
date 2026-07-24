-- ============================================
-- SMART ENERGY MONITOR - SUPABASE SCHEMA
-- Run this SQL in your Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================

-- ============================================
-- TABLE 1: sensor_data
-- Stores all sensor readings from ESP32
-- ============================================
CREATE TABLE IF NOT EXISTS sensor_data (
  id BIGSERIAL PRIMARY KEY,
  voltage FLOAT NOT NULL DEFAULT 0,
  current FLOAT NOT NULL DEFAULT 0,
  temperature FLOAT NOT NULL DEFAULT 0,
  humidity FLOAT NOT NULL DEFAULT 0,
  power FLOAT NOT NULL DEFAULT 0,        -- Calculated: voltage × current
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast time-series queries
CREATE INDEX IF NOT EXISTS idx_sensor_data_created_at ON sensor_data(created_at DESC);

-- ============================================
-- TABLE 2: control
-- Relay control state (ESP32 reads this)
-- ============================================
CREATE TABLE IF NOT EXISTS control (
  id INT PRIMARY KEY DEFAULT 1,
  relay_status BOOLEAN NOT NULL DEFAULT false,
  power_limit FLOAT NOT NULL DEFAULT 5000,    -- Max power threshold (W)
  current_limit FLOAT NOT NULL DEFAULT 25,    -- Max current threshold (A)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default control row
INSERT INTO control (id, relay_status, power_limit, current_limit, updated_at)
VALUES (1, false, 5000, 25, NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TABLE 3: user_energy
-- Tracks energy balance (bought, used, remaining)
-- ============================================
CREATE TABLE IF NOT EXISTS user_energy (
  id INT PRIMARY KEY DEFAULT 1,
  total_energy_bought FLOAT NOT NULL DEFAULT 0,   -- Total purchased (kWh)
  energy_used FLOAT NOT NULL DEFAULT 0,            -- Total consumed (kWh)
  energy_remaining FLOAT NOT NULL DEFAULT 0        -- Balance (kWh)
);

-- Insert default energy row
INSERT INTO user_energy (id, total_energy_bought, energy_used, energy_remaining)
VALUES (1, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TABLE 4: alerts
-- Stores system alerts and notifications
-- Types: normal, warning, faulty, power_loss
-- ============================================
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'normal' CHECK (type IN ('normal', 'warning', 'faulty', 'power_loss')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast alert queries
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Enable for production security
-- ============================================

-- Enable RLS on all tables
ALTER TABLE sensor_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE control ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_energy ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anonymous read/write for all tables
-- (For production, use authenticated users and API keys)

-- sensor_data policies
CREATE POLICY "Allow anonymous insert on sensor_data"
  ON sensor_data FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select on sensor_data"
  ON sensor_data FOR SELECT
  TO anon
  USING (true);

-- control policies
CREATE POLICY "Allow anonymous select on control"
  ON control FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous update on control"
  ON control FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- user_energy policies
CREATE POLICY "Allow anonymous select on user_energy"
  ON user_energy FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous update on user_energy"
  ON user_energy FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- alerts policies
CREATE POLICY "Allow anonymous insert on alerts"
  ON alerts FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select on alerts"
  ON alerts FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous delete on alerts"
  ON alerts FOR DELETE
  TO anon
  USING (true);

-- ============================================
-- ENABLE REALTIME FOR ALL TABLES
-- This is required for Supabase realtime subscriptions
-- ============================================

-- Go to Supabase Dashboard → Database → Replication
-- Enable realtime for: sensor_data, control, user_energy, alerts
-- OR run the following:

ALTER PUBLICATION supabase_realtime ADD TABLE sensor_data;
ALTER PUBLICATION supabase_realtime ADD TABLE control;
ALTER PUBLICATION supabase_realtime ADD TABLE user_energy;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;

-- ============================================
-- OPTIONAL: Auto-cleanup old sensor data (keep last 7 days)
-- Uncomment to enable
-- ============================================
-- CREATE OR REPLACE FUNCTION cleanup_old_sensor_data()
-- RETURNS void AS $$
-- BEGIN
--   DELETE FROM sensor_data WHERE created_at < NOW() - INTERVAL '7 days';
-- END;
-- $$ LANGUAGE plpgsql;

-- SELECT cron.schedule('cleanup-sensor-data', '0 0 * * *', 'SELECT cleanup_old_sensor_data();');

-- ============================================
-- DONE! Your database is ready.
-- ============================================
