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

    @Insert("""
            INSERT INTO cfg_env_station (id, name, location, lng, lat, client_id, enabled, sort_no, updated_at)
            VALUES (#{id}, #{name}, #{location}, #{lng}, #{lat}, #{clientId},
                    COALESCE(#{enabled}, TRUE), COALESCE(#{sortNo}, 0), NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              client_id = COALESCE(EXCLUDED.client_id, cfg_env_station.client_id),
              location = COALESCE(EXCLUDED.location, cfg_env_station.location),
              updated_at = NOW()
            """)
    int upsertEnvStationIgnore(CfgEnvStation row);

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
            ON CONFLICT (device_sn) DO UPDATE SET
              external_id = COALESCE(EXCLUDED.external_id, cfg_slope_device.external_id),
              name = EXCLUDED.name,
              device_kind = COALESCE(EXCLUDED.device_kind, cfg_slope_device.device_kind),
              updated_at = NOW()
            """)
    int insertSlopeDevice(CfgSlopeDevice row);

    @Insert("""
            INSERT INTO cfg_slope_device (device_sn, external_id, name, device_kind, enabled, sort_no, updated_at)
            VALUES (#{deviceSn}, #{externalId}, #{name}, #{deviceKind},
                    COALESCE(#{enabled}, TRUE), COALESCE(#{sortNo}, 0), NOW())
            ON CONFLICT (device_sn) DO UPDATE SET
              external_id = COALESCE(EXCLUDED.external_id, cfg_slope_device.external_id),
              name = EXCLUDED.name,
              device_kind = EXCLUDED.device_kind,
              updated_at = NOW()
            """)
    int upsertSlopeDevice(CfgSlopeDevice row);

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
              device_sn, collect_time, x_mm, y_mm, h_mm,
              plane_mm, plane_speed, plane_acc, azimuth, total_projection,
              speed_x, speed_y, speed_h, projection_speed, projection_acc, interval_hours,
              lng, lat, online, maintainer, vendor_point_id, vendor_color, alarm_text,
              device_type, source, topic, received_at, updated_at)
            VALUES (
              #{deviceSn}, #{collectTime}, #{xMm}, #{yMm}, #{hMm},
              #{planeMm}, #{planeSpeed}, #{planeAcc}, #{azimuth}, #{totalProjection},
              #{speedX}, #{speedY}, #{speedH}, #{projectionSpeed}, #{projectionAcc}, #{intervalHours},
              #{lng}, #{lat}, #{online}, #{maintainer}, #{vendorPointId}, #{vendorColor}, #{alarmText},
              #{deviceType}, #{source}, #{topic}, #{receivedAt}, NOW())
            ON CONFLICT (device_sn) DO UPDATE SET
              collect_time = COALESCE(EXCLUDED.collect_time, biz_slope_latest.collect_time),
              x_mm = COALESCE(EXCLUDED.x_mm, biz_slope_latest.x_mm),
              y_mm = COALESCE(EXCLUDED.y_mm, biz_slope_latest.y_mm),
              h_mm = COALESCE(EXCLUDED.h_mm, biz_slope_latest.h_mm),
              plane_mm = COALESCE(EXCLUDED.plane_mm, biz_slope_latest.plane_mm),
              plane_speed = COALESCE(EXCLUDED.plane_speed, biz_slope_latest.plane_speed),
              plane_acc = COALESCE(EXCLUDED.plane_acc, biz_slope_latest.plane_acc),
              azimuth = COALESCE(EXCLUDED.azimuth, biz_slope_latest.azimuth),
              total_projection = COALESCE(EXCLUDED.total_projection, biz_slope_latest.total_projection),
              speed_x = COALESCE(EXCLUDED.speed_x, biz_slope_latest.speed_x),
              speed_y = COALESCE(EXCLUDED.speed_y, biz_slope_latest.speed_y),
              speed_h = COALESCE(EXCLUDED.speed_h, biz_slope_latest.speed_h),
              projection_speed = COALESCE(EXCLUDED.projection_speed, biz_slope_latest.projection_speed),
              projection_acc = COALESCE(EXCLUDED.projection_acc, biz_slope_latest.projection_acc),
              interval_hours = COALESCE(EXCLUDED.interval_hours, biz_slope_latest.interval_hours),
              lng = COALESCE(EXCLUDED.lng, biz_slope_latest.lng),
              lat = COALESCE(EXCLUDED.lat, biz_slope_latest.lat),
              online = COALESCE(EXCLUDED.online, biz_slope_latest.online),
              maintainer = COALESCE(EXCLUDED.maintainer, biz_slope_latest.maintainer),
              vendor_point_id = COALESCE(EXCLUDED.vendor_point_id, biz_slope_latest.vendor_point_id),
              vendor_color = COALESCE(EXCLUDED.vendor_color, biz_slope_latest.vendor_color),
              alarm_text = COALESCE(EXCLUDED.alarm_text, biz_slope_latest.alarm_text),
              device_type = COALESCE(EXCLUDED.device_type, biz_slope_latest.device_type),
              source = EXCLUDED.source, topic = EXCLUDED.topic,
              received_at = EXCLUDED.received_at, updated_at = NOW()
            WHERE biz_slope_latest.collect_time IS NULL
               OR EXCLUDED.collect_time IS NULL
               OR EXCLUDED.collect_time >= biz_slope_latest.collect_time
            """)
    int upsertSlopeLatest(BizSlopeLatest row);

    @Insert("""
            INSERT INTO biz_rain_latest (
              device_sn, collect_time, rain_hour, rain_day, errcode, dev_chx,
              lng, lat, online, maintainer, vendor_point_id,
              source, topic, received_at, updated_at)
            VALUES (#{deviceSn}, #{collectTime}, #{rainHour}, #{rainDay}, #{errcode}, #{devChx},
                    #{lng}, #{lat}, #{online}, #{maintainer}, #{vendorPointId},
                    #{source}, #{topic}, #{receivedAt}, NOW())
            ON CONFLICT (device_sn) DO UPDATE SET
              collect_time = COALESCE(EXCLUDED.collect_time, biz_rain_latest.collect_time),
              rain_hour = COALESCE(EXCLUDED.rain_hour, biz_rain_latest.rain_hour),
              rain_day = COALESCE(EXCLUDED.rain_day, biz_rain_latest.rain_day),
              errcode = COALESCE(EXCLUDED.errcode, biz_rain_latest.errcode),
              dev_chx = COALESCE(EXCLUDED.dev_chx, biz_rain_latest.dev_chx),
              lng = COALESCE(EXCLUDED.lng, biz_rain_latest.lng),
              lat = COALESCE(EXCLUDED.lat, biz_rain_latest.lat),
              online = COALESCE(EXCLUDED.online, biz_rain_latest.online),
              maintainer = COALESCE(EXCLUDED.maintainer, biz_rain_latest.maintainer),
              vendor_point_id = COALESCE(EXCLUDED.vendor_point_id, biz_rain_latest.vendor_point_id),
              source = EXCLUDED.source, topic = EXCLUDED.topic,
              received_at = EXCLUDED.received_at, updated_at = NOW()
            WHERE biz_rain_latest.collect_time IS NULL
               OR EXCLUDED.collect_time IS NULL
               OR EXCLUDED.collect_time >= biz_rain_latest.collect_time
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
                   x_mm AS xMm, y_mm AS yMm, h_mm AS hMm,
                   plane_mm AS planeMm, plane_speed AS planeSpeed, plane_acc AS planeAcc,
                   azimuth, total_projection AS totalProjection,
                   speed_x AS speedX, speed_y AS speedY, speed_h AS speedH,
                   projection_speed AS projectionSpeed, projection_acc AS projectionAcc,
                   interval_hours AS intervalHours, lng, lat, online, maintainer,
                   vendor_point_id AS vendorPointId, vendor_color AS vendorColor, alarm_text AS alarmText,
                   device_type AS deviceType,
                   source, topic, received_at AS receivedAt, updated_at AS updatedAt
            FROM biz_slope_latest
            """)
    List<BizSlopeLatest> listSlopeLatest();

    @Select("""
            SELECT device_sn AS deviceSn, collect_time AS collectTime,
                   rain_hour AS rainHour, rain_day AS rainDay, errcode, dev_chx AS devChx,
                   lng, lat, online, maintainer, vendor_point_id AS vendorPointId,
                   source, topic, received_at AS receivedAt, updated_at AS updatedAt
            FROM biz_rain_latest
            """)
    List<BizRainLatest> listRainLatest();

    @Insert("""
            INSERT INTO biz_bdlx_alarm (
              vendor_id, point_id, device_sn, color, level, title, content, status, alarm_time, raw, updated_at)
            VALUES (
              #{vendorId}, #{pointId}, #{deviceSn}, #{color}, #{level}, #{title}, #{content},
              #{status}, #{alarmTime}, CAST(#{raw} AS jsonb), NOW())
            ON CONFLICT (vendor_id) DO UPDATE SET
              point_id = EXCLUDED.point_id, device_sn = EXCLUDED.device_sn,
              color = EXCLUDED.color, level = EXCLUDED.level, title = EXCLUDED.title,
              content = EXCLUDED.content, status = EXCLUDED.status, alarm_time = EXCLUDED.alarm_time,
              raw = EXCLUDED.raw, updated_at = NOW()
            """)
    int upsertBdlxAlarm(BizBdlxAlarm row);

    @Select("""
            SELECT vendor_id AS vendorId, point_id AS pointId, device_sn AS deviceSn,
                   color, level, title, content, status, alarm_time AS alarmTime,
                   raw::text AS raw
            FROM biz_bdlx_alarm
            ORDER BY alarm_time DESC NULLS LAST, vendor_id DESC
            LIMIT 200
            """)
    List<BizBdlxAlarm> listBdlxAlarms();

    @Select("""
            SELECT vendor_id AS vendorId, point_id AS pointId, device_sn AS deviceSn,
                   color, level, title, content, status, alarm_time AS alarmTime
            FROM biz_bdlx_alarm
            WHERE point_id = #{pointId}
            ORDER BY alarm_time DESC NULLS LAST
            LIMIT 1
            """)
    BizBdlxAlarm latestAlarmForPoint(@Param("pointId") String pointId);

    @Update("""
            UPDATE cfg_bdlx_pull SET
              last_success_at = #{at}, last_error = #{error},
              points_updated = #{points}, samples_upserted = #{samples},
              alarms_upserted = #{alarms}, updated_at = NOW()
            WHERE id = 1
            """)
    int updateBdlxPull(@Param("at") OffsetDateTime at, @Param("error") String error,
                       @Param("points") int points, @Param("samples") int samples,
                       @Param("alarms") int alarms);

    @Select("""
            SELECT last_success_at AS lastSuccessAt, last_error AS lastError,
                   points_updated AS pointsUpdated, samples_upserted AS samplesUpserted,
                   alarms_upserted AS alarmsUpserted, updated_at AS updatedAt,
                   enabled, web_url AS webUrl, api_base AS apiBase,
                   username, password, cron, lookback_hours AS lookbackHours
            FROM cfg_bdlx_pull WHERE id = 1
            """)
    java.util.Map<String, Object> getBdlxPull();

    @Update("""
            UPDATE cfg_bdlx_pull SET
              enabled = COALESCE(#{enabled}, enabled),
              web_url = #{webUrl},
              api_base = #{apiBase},
              username = #{username},
              password = #{password},
              cron = #{cron},
              lookback_hours = #{lookbackHours},
              updated_at = NOW()
            WHERE id = 1
            """)
    int updateBdlxLoginCfg(CfgBdlx row);

    @Update("""
            UPDATE cfg_ft_env_pull SET
              last_success_at = COALESCE(#{at}, last_success_at), last_error = #{error},
              points_updated = #{points}, samples_upserted = #{samples}, updated_at = NOW()
            WHERE id = 1
            """)
    int updateFtEnvPull(@Param("at") OffsetDateTime at, @Param("error") String error,
                        @Param("points") int points, @Param("samples") int samples);

    @Select("""
            SELECT last_success_at AS lastSuccessAt, last_error AS lastError,
                   points_updated AS pointsUpdated, samples_upserted AS samplesUpserted,
                   updated_at AS updatedAt, enabled, web_url AS webUrl, api_base AS apiBase,
                   username, password, cron, lookback_hours AS lookbackHours
            FROM cfg_ft_env_pull WHERE id = 1
            """)
    java.util.Map<String, Object> getFtEnvPull();

    @Update("""
            UPDATE cfg_ft_env_pull SET
              enabled = COALESCE(#{enabled}, enabled),
              web_url = #{webUrl},
              api_base = #{apiBase},
              username = #{username},
              password = #{password},
              cron = #{cron},
              lookback_hours = #{lookbackHours},
              updated_at = NOW()
            WHERE id = 1
            """)
    int updateFtEnvLoginCfg(CfgFtEnv row);

    @Select("SELECT COUNT(*) FROM biz_env_latest")
    int countEnvLatest();

    @Delete("DELETE FROM ts_env_sample WHERE sampled_at < #{before}")
    int deleteEnvSamplesBefore(@Param("before") OffsetDateTime before);

    @Delete("DELETE FROM ts_slope_sample WHERE sampled_at < #{before}")
    int deleteSlopeSamplesBefore(@Param("before") OffsetDateTime before);
}
