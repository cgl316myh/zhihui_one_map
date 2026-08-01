package com.anr.mineonemap.mapper;

import com.anr.mineonemap.domain.SysAuditLog;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface SysAuditLogMapper {

    @Insert("""
            INSERT INTO sys_audit_log (actor, action, target, result, summary, ip)
            VALUES (#{actor}, #{action}, #{target}, #{result}, #{summary}, #{ip})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(SysAuditLog log);

    @Select("""
            <script>
            SELECT * FROM sys_audit_log
            <where>
              <if test="actor != null and actor != ''">AND actor = #{actor}</if>
              <if test="action != null and action != ''">AND action = #{action}</if>
            </where>
            ORDER BY created_at DESC
            LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<SysAuditLog> list(@Param("actor") String actor, @Param("action") String action,
                           @Param("limit") int limit, @Param("offset") int offset);

    @Select("""
            <script>
            SELECT COUNT(*) FROM sys_audit_log
            <where>
              <if test="actor != null and actor != ''">AND actor = #{actor}</if>
              <if test="action != null and action != ''">AND action = #{action}</if>
            </where>
            </script>
            """)
    long count(@Param("actor") String actor, @Param("action") String action);
}
