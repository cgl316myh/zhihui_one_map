package com.anr.mineonemap.mapper;

import com.anr.mineonemap.domain.BizMapPoint;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface BizMapPointMapper {

    @Select("SELECT id, name, type, lng, lat, external_id, extra::text AS extra, updated_at FROM biz_map_point ORDER BY id")
    List<BizMapPoint> listAll();

    @Select("SELECT COUNT(*) FROM biz_map_point")
    int countAll();

    @Insert("""
            INSERT INTO biz_map_point (id, name, type, lng, lat, external_id, extra, updated_at)
            VALUES (#{id}, #{name}, #{type}, #{lng}, #{lat}, #{externalId},
                    COALESCE(CAST(#{extra} AS jsonb), '{}'::jsonb), NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, type = EXCLUDED.type, lng = EXCLUDED.lng, lat = EXCLUDED.lat,
              external_id = EXCLUDED.external_id, extra = EXCLUDED.extra, updated_at = NOW()
            """)
    int upsert(BizMapPoint point);
}
