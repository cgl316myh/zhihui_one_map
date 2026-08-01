package com.anr.mineonemap.mapper;

import com.anr.mineonemap.domain.BizVideoCamera;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface BizVideoCameraMapper {

    @Select("SELECT id, name, lng, lat, online, scene, sort_no, extra::text AS extra, updated_at FROM biz_video_camera ORDER BY sort_no, id")
    List<BizVideoCamera> listAll();

    @Insert("""
            INSERT INTO biz_video_camera (id, name, lng, lat, online, scene, sort_no, extra, updated_at)
            VALUES (#{id}, #{name}, #{lng}, #{lat}, #{online}, #{scene}, #{sortNo},
                    COALESCE(CAST(#{extra} AS jsonb), '{}'::jsonb), NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, lng = EXCLUDED.lng, lat = EXCLUDED.lat,
              online = EXCLUDED.online, scene = EXCLUDED.scene, sort_no = EXCLUDED.sort_no,
              extra = EXCLUDED.extra, updated_at = NOW()
            """)
    int upsert(BizVideoCamera camera);

    @Delete("DELETE FROM biz_video_camera WHERE id = #{id}")
    int deleteById(String id);
}
