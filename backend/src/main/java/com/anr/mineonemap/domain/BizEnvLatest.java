package com.anr.mineonemap.domain;

import java.time.OffsetDateTime;

public class BizEnvLatest {
    private String clientId;
    private String stationId;
    private OffsetDateTime detectedTime;
    private Double ambientTemperature;
    private Double ambientHumidity;
    private Double pressure;
    private Double windSpeed;
    private Integer windScale;
    private Double windDirection;
    private Double rainfall;
    private Double noise;
    private Double pm25;
    private Double pm10;
    private Double tsp;
    private Double rssi;
    private Double longitude;
    private Double latitude;
    private String source;
    private String topic;
    private OffsetDateTime receivedAt;
    private OffsetDateTime updatedAt;

    public String getClientId() { return clientId; }
    public void setClientId(String clientId) { this.clientId = clientId; }
    public String getStationId() { return stationId; }
    public void setStationId(String stationId) { this.stationId = stationId; }
    public OffsetDateTime getDetectedTime() { return detectedTime; }
    public void setDetectedTime(OffsetDateTime detectedTime) { this.detectedTime = detectedTime; }
    public Double getAmbientTemperature() { return ambientTemperature; }
    public void setAmbientTemperature(Double ambientTemperature) { this.ambientTemperature = ambientTemperature; }
    public Double getAmbientHumidity() { return ambientHumidity; }
    public void setAmbientHumidity(Double ambientHumidity) { this.ambientHumidity = ambientHumidity; }
    public Double getPressure() { return pressure; }
    public void setPressure(Double pressure) { this.pressure = pressure; }
    public Double getWindSpeed() { return windSpeed; }
    public void setWindSpeed(Double windSpeed) { this.windSpeed = windSpeed; }
    public Integer getWindScale() { return windScale; }
    public void setWindScale(Integer windScale) { this.windScale = windScale; }
    public Double getWindDirection() { return windDirection; }
    public void setWindDirection(Double windDirection) { this.windDirection = windDirection; }
    public Double getRainfall() { return rainfall; }
    public void setRainfall(Double rainfall) { this.rainfall = rainfall; }
    public Double getNoise() { return noise; }
    public void setNoise(Double noise) { this.noise = noise; }
    public Double getPm25() { return pm25; }
    public void setPm25(Double pm25) { this.pm25 = pm25; }
    public Double getPm10() { return pm10; }
    public void setPm10(Double pm10) { this.pm10 = pm10; }
    public Double getTsp() { return tsp; }
    public void setTsp(Double tsp) { this.tsp = tsp; }
    public Double getRssi() { return rssi; }
    public void setRssi(Double rssi) { this.rssi = rssi; }
    public Double getLongitude() { return longitude; }
    public void setLongitude(Double longitude) { this.longitude = longitude; }
    public Double getLatitude() { return latitude; }
    public void setLatitude(Double latitude) { this.latitude = latitude; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public OffsetDateTime getReceivedAt() { return receivedAt; }
    public void setReceivedAt(OffsetDateTime receivedAt) { this.receivedAt = receivedAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
