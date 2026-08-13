package com.anr.mineonemap.mapper;

import com.anr.mineonemap.domain.BizSensorLatest;
import org.apache.ibatis.annotations.*;

import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface SensorPersistMapper {

    @Insert("""
            INSERT INTO biz_sensor_latest (category, sensor_key, source, topic, payload, received_at, updated_at)
            VALUES (#{category}, #{sensorKey}, #{source}, #{topic}, CAST(#{payload} AS jsonb), #{receivedAt}, NOW())
            ON CONFLICT (category, sensor_key) DO UPDATE SET
              source = EXCLUDED.source,
              topic = EXCLUDED.topic,
              payload = EXCLUDED.payload,
              received_at = EXCLUDED.received_at,
              updated_at = NOW()
            """)
    int upsertLatest(BizSensorLatest row);

    @Insert("""
            INSERT INTO biz_sensor_event (category, sensor_key, source, topic, payload, received_at)
            VALUES (#{category}, #{sensorKey}, #{source}, #{topic}, CAST(#{payload} AS jsonb), #{receivedAt})
            """)
    int insertEvent(@Param("category") String category,
                    @Param("sensorKey") String sensorKey,
                    @Param("source") String source,
                    @Param("topic") String topic,
                    @Param("payload") String payload,
                    @Param("receivedAt") OffsetDateTime receivedAt);

    @Insert("""
            INSERT INTO ts_env_sample (point_id, metric, value, sampled_at)
            VALUES (#{pointId}, #{metric}, #{value}, #{sampledAt})
            """)
    int insertEnvSample(@Param("pointId") String pointId,
                        @Param("metric") String metric,
                        @Param("value") Double value,
                        @Param("sampledAt") OffsetDateTime sampledAt);

    @Insert("""
            INSERT INTO ts_slope_sample (point_id, x, y, h, magnitude, sampled_at)
            VALUES (#{pointId}, #{x}, #{y}, #{h}, #{magnitude}, #{sampledAt})
            """)
    int insertSlopeSample(@Param("pointId") String pointId,
                          @Param("x") Double x,
                          @Param("y") Double y,
                          @Param("h") Double h,
                          @Param("magnitude") Double magnitude,
                          @Param("sampledAt") OffsetDateTime sampledAt);

    @Select("""
            SELECT category, sensor_key AS sensorKey, source, topic,
                   payload::text AS payload, received_at AS receivedAt, updated_at AS updatedAt
            FROM biz_sensor_latest
            ORDER BY received_at DESC
            """)
    List<BizSensorLatest> listAllLatest();
}
