package com.anr.mineonemap.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface CfgMapper {

    @Select("SELECT payload::text FROM cfg_env_threshold WHERE id = 1")
    String getEnvThresholdPayload();

    @Update("""
            UPDATE cfg_env_threshold SET payload = CAST(#{payload} AS jsonb),
            updated_at = NOW(), updated_by = #{updatedBy} WHERE id = 1
            """)
    int updateEnvThreshold(@Param("payload") String payload, @Param("updatedBy") String updatedBy);

    @Select("SELECT payload::text FROM cfg_map WHERE id = 1")
    String getMapPayload();

    @Update("""
            UPDATE cfg_map SET payload = CAST(#{payload} AS jsonb),
            updated_at = NOW(), updated_by = #{updatedBy} WHERE id = 1
            """)
    int updateMap(@Param("payload") String payload, @Param("updatedBy") String updatedBy);

    @Select("SELECT payload::text FROM cfg_sensor_bridge WHERE id = 1")
    String getSensorBridgePayload();

    @Update("""
            UPDATE cfg_sensor_bridge SET payload = CAST(#{payload} AS jsonb),
            updated_at = NOW(), updated_by = #{updatedBy} WHERE id = 1
            """)
    int updateSensorBridge(@Param("payload") String payload, @Param("updatedBy") String updatedBy);

    @Select("SELECT payload::text FROM cfg_reserves WHERE id = 1")
    String getReservesPayload();

    @Update("""
            UPDATE cfg_reserves SET payload = CAST(#{payload} AS jsonb),
            updated_at = NOW(), updated_by = #{updatedBy} WHERE id = 1
            """)
    int updateReserves(@Param("payload") String payload, @Param("updatedBy") String updatedBy);

    @Select("SELECT payload::text FROM biz_production WHERE id = 1")
    String getProductionPayload();

    @Update("""
            UPDATE biz_production SET payload = CAST(#{payload} AS jsonb),
            updated_at = NOW() WHERE id = 1
            """)
    int updateProduction(@Param("payload") String payload);
}
