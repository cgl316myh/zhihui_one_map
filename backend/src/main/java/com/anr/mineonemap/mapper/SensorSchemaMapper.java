package com.anr.mineonemap.mapper;

import com.anr.mineonemap.domain.*;
import org.apache.ibatis.annotations.*;

import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface SensorSchemaMapper {

    @Select("""
            SELECT id, enabled, demo_push_enabled AS demoPushEnabled,
                   demo_push_interval_sec AS demoPushIntervalSec,
                   env_retention_months AS envRetentionMonths,
                   updated_at AS updatedAt, updated_by AS updatedBy
            FROM cfg_sensor_ingest WHERE id = 1
            """)
    CfgSensorIngest getIngest();

    @Update("""
            UPDATE cfg_sensor_ingest SET
              enabled = #{enabled},
              demo_push_enabled = #{demoPushEnabled},
              demo_push_interval_sec = #{demoPushIntervalSec},
              env_retention_months = #{envRetentionMonths},
              updated_at = NOW(),
              updated_by = #{updatedBy}
            WHERE id = 1
            """)
    int updateIngest(CfgSensorIngest row);

    @Select("""
            SELECT id, name, location, lng, lat, client_id AS clientId,
                   enabled, sort_no AS sortNo, updated_at AS updatedAt
            FROM cfg_env_station ORDER BY sort_no, id
            """)
    List<CfgEnvStation> listStations();

    @Select("SELECT COUNT(*) FROM cfg_env_station")
    int countStations();

    @Delete("DELETE FROM cfg_env_station")
    int deleteAllStations();

    @Insert("""
            INSERT INTO cfg_env_station (id, name, location, lng, lat, client_id, enabled, sort_no, updated_at)
            VALUES (#{id}, #{name}, #{location}, #{lng}, #{lat}, #{clientId},
                    COALESCE(#{enabled}, TRUE), COALESCE(#{sortNo}, 0), NOW())
            """)
    int insertStation(CfgEnvStation row);

    @Select("""
            SELECT device_sn AS deviceSn, external_id AS externalId, name,
                   device_kind AS deviceKind, enabled, sort_no AS sortNo, updated_at AS updatedAt
            FROM cfg_slope_device ORDER BY sort_no, device_sn
            """)
    List<CfgSlopeDevice> listSlopeDevices();

    @Select("SELECT COUNT(*) FROM cfg_slope_device")
    int countSlopeDevices();

    @Delete("DELETE FROM cfg_slope_device")
    int deleteAllSlopeDevices();

    @Insert("""
            INSERT INTO cfg_slope_device (device_sn, external_id, name, device_kind, enabled, sort_no, updated_at)
            VALUES (#{deviceSn}, #{externalId}, #{name}, #{deviceKind},
                    COALESCE(#{enabled}, TRUE), COALESCE(#{sortNo}, 0), NOW())
            """)
    int insertSlopeDevice(CfgSlopeDevice row);

    @Select("""
            SELECT noise_day AS "noiseDay", noise_night AS "noiseNight",
                   pm25 AS "pm25", pm10 AS "pm10"
            FROM cfg_sensor_threshold WHERE id = 1
            """)
    java.util.Map<String, Object> getSensorThreshold();

    @Update("""
            UPDATE cfg_sensor_threshold SET
              noise_day = #{noiseDay}, noise_night = #{noiseNight},
              pm25 = #{pm25}, pm10 = #{pm10}, updated_at = NOW()
            WHERE id = 1
            """)
    int updateSensorThreshold(@Param("noiseDay") Double noiseDay,
                              @Param("noiseNight") Double noiseNight,
                              @Param("pm25") Double pm25,
                              @Param("pm10") Double pm10);

    @Select("SELECT last_success_at FROM cfg_cloud_pull_cursor WHERE id = 1")
    OffsetDateTime getCloudPullCursor();

    @Update("""
            UPDATE cfg_cloud_pull_cursor SET last_success_at = #{at}, last_error = #{error}, updated_at = NOW()
            WHERE id = 1
            """)
    int updateCloudPullCursor(@Param("at") OffsetDateTime at, @Param("error") String error);

    @Insert("""
            INSERT INTO biz_env_latest (
              client_id, station_id, detected_time,
              ambient_temperature, ambient_humidity, pressure, wind_speed, wind_scale, wind_direction,
              rainfall, noise, pm25, pm10, tsp, rssi, longitude, latitude,
              source, topic, received_at, updated_at)
            VALUES (
              #{clientId}, #{stationId}, #{detectedTime},
              #{ambientTemperature}, #{ambientHumidity}, #{pressure}, #{windSpeed}, #{windScale}, #{windDirection},
              #{rainfall}, #{noise}, #{pm25}, #{pm10}, #{tsp}, #{rssi}, #{longitude}, #{latitude},
              #{source}, #{topic}, #{receivedAt}, NOW())
            ON CONFLICT (client_id) DO UPDATE SET
              station_id = EXCLUDED.station_id,
              detected_time = EXCLUDED.detected_time,
              ambient_temperature = EXCLUDED.ambient_temperature,
              ambient_humidity = EXCLUDED.ambient_humidity,
              pressure = EXCLUDED.pressure,
              wind_speed = EXCLUDED.wind_speed,
              wind_scale = EXCLUDED.wind_scale,
              wind_direction = EXCLUDED.wind_direction,
              rainfall = EXCLUDED.rainfall,
              noise = EXCLUDED.noise,
              pm25 = EXCLUDED.pm25,
              pm10 = EXCLUDED.pm10,
              tsp = EXCLUDED.tsp,
              rssi = EXCLUDED.rssi,
              longitude = EXCLUDED.longitude,
              latitude = EXCLUDED.latitude,
              source = EXCLUDED.source,
              topic = EXCLUDED.topic,
              received_at = EXCLUDED.received_at,
              updated_at = NOW()
            """)
    int upsertEnvLatest(BizEnvLatest row);

    @Insert("""
            INSERT INTO biz_slope_latest (
              device_sn, collect_time, x_mm, y_mm, h_mm, device_type, source, topic, received_at, updated_at)
            VALUES (#{deviceSn}, #{collectTime}, #{xMm}, #{yMm}, #{hMm}, #{deviceType},
                    #{source}, #{topic}, #{receivedAt}, NOW())
            ON CONFLICT (device_sn) DO UPDATE SET
              collect_time = EXCLUDED.collect_time,
              x_mm = EXCLUDED.x_mm, y_mm = EXCLUDED.y_mm, h_mm = EXCLUDED.h_mm,
              device_type = EXCLUDED.device_type, source = EXCLUDED.source, topic = EXCLUDED.topic,
              received_at = EXCLUDED.received_at, updated_at = NOW()
            """)
    int upsertSlopeLatest(BizSlopeLatest row);

    @Insert("""
            INSERT INTO biz_rain_latest (
              device_sn, collect_time, rain_hour, rain_day, errcode, dev_chx, source, topic, received_at, updated_at)
            VALUES (#{deviceSn}, #{collectTime}, #{rainHour}, #{rainDay}, #{errcode}, #{devChx},
                    #{source}, #{topic}, #{receivedAt}, NOW())
            ON CONFLICT (device_sn) DO UPDATE SET
              collect_time = EXCLUDED.collect_time,
              rain_hour = EXCLUDED.rain_hour, rain_day = EXCLUDED.rain_day,
              errcode = EXCLUDED.errcode, dev_chx = EXCLUDED.dev_chx,
              source = EXCLUDED.source, topic = EXCLUDED.topic,
              received_at = EXCLUDED.received_at, updated_at = NOW()
            """)
    int upsertRainLatest(BizRainLatest row);

    @Select("""
            SELECT client_id AS clientId, station_id AS stationId, detected_time AS detectedTime,
                   ambient_temperature AS ambientTemperature, ambient_humidity AS ambientHumidity,
                   pressure, wind_speed AS windSpeed, wind_scale AS windScale, wind_direction AS windDirection,
                   rainfall, noise, pm25, pm10, tsp, rssi, longitude, latitude,
                   source, topic, received_at AS receivedAt, updated_at AS updatedAt
            FROM biz_env_latest
            """)
    List<BizEnvLatest> listEnvLatest();

    @Select("""
            SELECT device_sn AS deviceSn, collect_time AS collectTime,
                   x_mm AS xMm, y_mm AS yMm, h_mm AS hMm, device_type AS deviceType,
                   source, topic, received_at AS receivedAt, updated_at AS updatedAt
            FROM biz_slope_latest
            """)
    List<BizSlopeLatest> listSlopeLatest();

    @Select("""
            SELECT device_sn AS deviceSn, collect_time AS collectTime,
                   rain_hour AS rainHour, rain_day AS rainDay, errcode, dev_chx AS devChx,
                   source, topic, received_at AS receivedAt, updated_at AS updatedAt
            FROM biz_rain_latest
            """)
    List<BizRainLatest> listRainLatest();

    @Select("SELECT COUNT(*) FROM biz_env_latest")
    int countEnvLatest();

    @Delete("DELETE FROM ts_env_sample WHERE sampled_at < #{before}")
    int deleteEnvSamplesBefore(@Param("before") OffsetDateTime before);

    @Delete("DELETE FROM ts_slope_sample WHERE sampled_at < #{before}")
    int deleteSlopeSamplesBefore(@Param("before") OffsetDateTime before);
}
