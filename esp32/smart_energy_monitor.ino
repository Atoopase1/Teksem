#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// Wokwi Simulated WiFi
const char* WIFI_SSID     = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";

// Your Supabase Keys
const char* SUPABASE_URL   = "https://etlagrvacikinnihpyss.supabase.co";  
const char* SUPABASE_KEY   = "sb_publishable_2T_CWwn_6_jdKV1q4mY4Eg_z7S_jPEE";

// Your Custom Pin Configuration
#define VOLTAGE_PIN   34    // Potentiometer 1
#define CURRENT_PIN   35    // Potentiometer 2
#define DHT_PIN       15    // DHT22 Data Pin
#define RELAY_PIN     23    // Relay Module IN
#define DHT_TYPE      DHT22

// OLED Display Size
#define SCREEN_WIDTH 128 
#define SCREEN_HEIGHT 64 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

DHT dht(DHT_PIN, DHT_TYPE);



unsigned long lastSendTime = 0;
unsigned long lastRelayCheck = 0;
bool relayState = false;

void setup() {
  Serial.begin(115200);
  
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Relay OFF initially
  pinMode(VOLTAGE_PIN, INPUT);
  pinMode(CURRENT_PIN, INPUT);
  
  // Initialize OLED Display
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("SSD1306 allocation failed"));
    for(;;);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0,20);
  display.println("SMART ENERGY");
  display.println("MONITOR BOOTING...");
  display.display();
  
  dht.begin();
  
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  
  // SWEET SPOT RESTORED: Check relay every 1.5 seconds 
  if (millis() - lastRelayCheck >= 1500) {
    lastRelayCheck = millis();
    checkRelayStatus();
  }

  // SWEET SPOT RESTORED: Update sensors every 1.5 seconds 
  if (millis() - lastSendTime >= 1500) {
    lastSendTime = millis();
    
    // Read Potentiometers to Simulate 0-260V and 0-30A
    float voltage = (analogRead(VOLTAGE_PIN) / 4095.0) * 260.0;
    float current = (analogRead(CURRENT_PIN) / 4095.0) * 30.0;
    
    // Read DHT22
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();
    float power = voltage * current;

    // Update OLED Display
    updateDisplay(voltage, current, power, temperature, relayState);

    // Send to Supabase Dashboard
    sendToSupabase(voltage, current, temperature, humidity, power);
  }
}

void updateDisplay(float v, float c, float p, float t, bool isRelayOn) {
  display.clearDisplay();
  
  // Header
  display.setTextSize(1);
  display.setCursor(0,0);
  display.print("SMART ENERGY MONITOR");
  
  // Power Status
  display.setCursor(0, 15);
  display.print("V: "); display.print(v, 1); display.print("V");
  display.setCursor(64, 15);
  display.print("I: "); display.print(c, 2); display.print("A");
  
  // Total Power
  display.setTextSize(2);
  display.setCursor(0, 30);
  display.print(p, 0); display.print(" W");
  
  // Footer
  display.setTextSize(1);
  display.setCursor(0, 52);
  display.print("Temp: "); display.print(t, 1); display.print("C");
  
  display.setCursor(80, 52);
  if (isRelayOn) {
    display.print("[ON]");
  } else {
    display.print("[OFF]");
  }
  
  display.display();
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  display.clearDisplay();
  display.setCursor(0,25);
  display.print("Connecting WiFi...");
  display.display();
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  display.clearDisplay();
}

void sendToSupabase(float v, float c, float t, float h, float p) {
  if (WiFi.status() != WL_CONNECTED) return;
  
  WiFiClientSecure client;
  client.setInsecure(); // Skip SSL check
  
  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/sensor_data";
  
  http.begin(client, url); 
  
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");
  
  StaticJsonDocument<200> doc;
  doc["voltage"] = v;
  doc["current"] = c;
  doc["temperature"] = t;
  doc["humidity"] = h;
  doc["power"] = p;
  
  String payload;
  serializeJson(doc, payload);
  int httpCode = http.POST(payload);
  http.end();
  client.stop();
  
  if(httpCode == 201) {
      Serial.println("✅ Sent to Web Dashboard!");
  } else {
      Serial.print("⚠️ Transmission Failed - Error Code: ");
      Serial.print(httpCode);
      Serial.print(" (");
      Serial.print(http.errorToString(httpCode).c_str());
      Serial.println(")");
  }
}

void checkRelayStatus() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // Skip SSL check
  
  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/control?id=eq.1&select=relay_status";
  
  http.begin(client, url); 
  
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  int httpCode = http.GET();
  
  if (httpCode == 200) {
    StaticJsonDocument<200> doc;
    deserializeJson(doc, http.getString());
    bool newRelayState = doc[0]["relay_status"];
    
    if (newRelayState != relayState) {
      relayState = newRelayState;
      digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);
      Serial.printf("🔌 Relay Toggled by Web Dashboard: %s\n", relayState ? "ON" : "OFF");
  } else {
    Serial.print("⚠️ Relay Check Failed - Error Code: ");
    Serial.print(httpCode);
    Serial.print(" (");
    Serial.print(http.errorToString(httpCode).c_str());
    Serial.println(")");
  }
  http.end();
  client.stop();
}
